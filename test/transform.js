let http = require("http");
let url = require("url");

let PORT = process.env.PORT || 4291;
let DOMAIN = process.env.DOMAIN || "mydomain.net";

http.createServer(function (req, res) {
	let data = [];
	req.on("data", function(chunk) {
		data.push(chunk.toString());
	});
	req.on("end", function() {
		if(!data.length) {
			res.writeHead(400, {
				"Content-Type": "text/plain"
			});
			res.end("400 Bad Request");
			return;
		} else {

			let url_in = data.join("")
			let hostname_in = url.parse(url_in).hostname;
			let transformed = url_in.replace(hostname_in, DOMAIN);

			res.writeHead(200, {
				"Content-Type": "text/plain",
				"Location": transformed
			});
			res.end();
			console.log(url_in + " -> " + transformed);
		}
	});
}).listen(PORT);
console.log("transform service listening on " + PORT);
