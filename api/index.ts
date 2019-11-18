const VERSION = "0.0.1";

//require("util.promisify/shim")(); /* must be before require("util") */
const util = require("util");
import program = require("commander");
let app	 = require("connect")();
let http = require("http");
let swaggerTools = require("swagger-tools");
let fs   = require("fs-extra");
let path = require("path");
let url  = require("url");

let cmdopts = {};
let store = "";

// swaggerRouter configuration
var swOpt = {
	controllers: "./controllers",
	useStubs: true
  //useStubs: true //turn on stubs (mock mode)
};

const getContent = function(url: string): Promise<string> {
  // return new pending promise
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      // handle http errors
      if(response.statusCode < 200 || response.statusCode > 299) {
         reject(new Error('Failed to load page, status code: ' + response.statusCode));
       }
      // temporary data holder
      const body = [];
      // on every content chunk, push it to the data array
      response.on("data", (chunk) => body.push(chunk));
      // we are done, resolve promise with those joined chunks
      response.on("end", () => resolve(body.join("")));
    });
    // handle connection errors of the request
    request.on("error", (err) => reject(err))
    })
};

if(require.main === module) {
    program.version(VERSION)
		.description("")
		.option("-p, --port", "port to listen on (env: PORT)")
		.option("-s, --store", "URL of HTTP storage service (env: STORE)")
		.option("-t, --transform", "URL-transformation service (env: TRANSFORM)")
		.option("-r, --replace", "replace hostname in URLs (env: REPLACE)")
		.parse(process.argv);
    cmdopts = program.opts();
}

Promise.resolve().then(() => {
	process.env.PORT = cmdopts["port"] || process.env.PORT || 7001;
	process.env.STORE = cmdopts["store"] || process.env.STORE || "";
	process.env.TRANSFORM = cmdopts["transform"] || process.env.TRANSFORM || "";
	process.env.REPLACE = cmdopts["replace"] || process.env.REPLACE || "";
    return;
})
.then(() => {
	let swaggerDoc = require("./swagger.json");
	// Initialize the Swagger middleware
	swaggerTools.initializeMiddleware(swaggerDoc, function (middleware) {
		// Interpret Swagger resources and attach metadata to request - must be first in swagger-tools middleware chain
		app.use(middleware.swaggerMetadata());

		// Validate Swagger requests
		app.use(middleware.swaggerValidator());

		// Route validated requests to appropriate controller
		app.use(middleware.swaggerRouter(swOpt));

		// Serve the Swagger documents and Swagger UI
		app.use(middleware.swaggerUi());

		// serve our own UI docroot for testing
		app.use(function(req, res) {
			let types = {
				".html": "text/html",
				".css": "text/css",
				".js": "text/javascript"
			};

			if(req.url.indexOf("/.") >= 0) {
				// handle naughty requests
				res.statusCode = 400;
				res.end("nope.");
			} else {
				// serve up UI from docroot
				let uri = url.parse(req.url).pathname;
				let filename = path.join(__dirname + "/../docroot" + uri);
				fs.exists(filename, function(exists) {
					if(!exists) {
						res.writeHead(404, {
							"Content-Type": "text/plain"
						});
						res.write("404 Not Found\n");
						res.end();
						return;
					}

					if(fs.statSync(filename).isDirectory()) {
						filename += "/index.html";
					}
					fs.readFile(filename, "binary", function(err, file) {
						if(err) {
							res.writeHead(500, {
								"Content-Type": "text/plain"
							});
							res.write(err + "\n");
							res.end();
							return;
						}
						let headers = {};
						let contentType = types[path.extname(filename)];
						if(contentType) {
							headers["Content-Type"] = contentType;
						}
						res.writeHead(200, headers);
						res.write(file, "binary");
						res.end();
					});
				});
			}
		});

		// Start the server
		let server = http.createServer((req, res) => {
			return app(req, res);
		});
		server.listen(process.env.PORT);
		server.on("listening", () => {
			console.log("Listening on port " + process.env.PORT);
			if(process.env.STORE) {
				console.log("Using store " + process.env.STORE);
			} else {
				console.log("No STORE provided; attachments will just vanish");
			}
			if(process.env.TRANSFORM) {
				console.log("Using transform " + process.env.TRANSFORM);
			} else if(process.env.REPLACE) {
				console.log("Using replacement host " + process.env.REPLACE);
			}
		});
	});
});
