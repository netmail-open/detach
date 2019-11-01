let url = require("url");
let http = require("http");
const Readable = require("stream").Readable;
let Splitter = require("mailsplit").Splitter;
let Joiner = require("mailsplit").Joiner;
let Rewriter = require("mailsplit").Rewriter;
const util = require("util");
let fs = require("fs-extra");
const writeFileAsync = util.promisify(fs.writeFile);
const readFileAsync  = util.promisify(fs.readFile);

function sendToStore(part, node, filename, type) {
	return Promise.resolve().then(() => {
		if(!process.env.STORE) {
			return null;
		}

		let uri = url.parse(process.env.STORE);
		return new Promise((resolve, reject) => {
			let req = http.request({
				hostname: uri.hostname,
				port: uri.port,
				method: "POST",
				headers: {
					"Content-Type": type,
					"Content-Disposition": [
						"attachment",
						(filename ? ("; filename=" + filename) : "")
					].join("")
				},
				path: uri.pathname
			}, function(res) {
				console.log("stored:   " + res.headers["location"]);
				resolve(res.headers["location"]);
			});
			req.on("error", function(err) {
				console.error("failed to contact store");
				reject(err);
			});
			req.end(part);
		});
	});
}

export function stripAttachments(req, res, next) {
	return Promise.resolve().then(() => {
		const s = new Readable();
		s.push(req.swagger.params.mime.value);
		s.push(null);

		let splitter = new Splitter();
		let joiner = new Joiner();
		let rewriter = new Rewriter((node) => {
			var filename = node.filename;
			var disposition = node.headers.getFirst("Content-Disposition");
			var encoding = node.headers.getFirst("Content-Transfer-Encoding") || "";
			if(node.disposition === "attachment" ||
			   (node.filename && encoding.toLowerCase().trim() === "base64")) {
				/*
				   we do this dance while deciding whether we want to
				   rewrite the part, because by the time we're in the
				   "node" handler, the encoder and decoder have already
				   been set up.  since we don't want our replacement
				   part to be (probably) base64-encoded, we'll steal
				   the relevant values and decode it ourselves.
				*/
				node.headers.remove("Content-Transfer-Encoding");
				node.headers.add("X-NetGovern-Filename", filename);
				node.headers.add("X-NetGovern-Encoding", encoding);
				node.headers.add("X-NetGovern-Disposition", disposition);
				node.headers.add("X-NetGovern-Type", node.contentType);
				node.encoding = "";
				return true;
			}
			return false;
		});
		rewriter.on("node", (data) => {
			let node = data.node;
			let enc = node.headers.getFirst("X-NetGovern-Encoding");
			let typ = node.headers.getFirst("X-NetGovern-Type");
			let name = node.headers.getFirst("X-NetGovern-Filename");

			/* second part of the header dance */
			node.headers.remove("X-NetGovern-Encoding");
			node.headers.remove("X-NetGovern-Type");
			node.headers.remove("X-NetGovern-Filename");
			node.setFilename("");
			node.headers.remove("Content-Disposition");
			node.headers.add("X-NetGovern-Detach", new Date().toISOString());
			node.setContentType("text/plain");
			node.encoding = "";

			let part = [];
			data.decoder.on("data", (chunk) => {
				part.push(chunk);
			});
			data.decoder.on("end", () => {
				/* final dance steps: decode manually */
				let buf = null;
				if("base64" === enc.toLowerCase().trim()) {
					buf = Buffer.from(part.join(""), "base64");
				} else {
					buf = Buffer.concat(part);
				}
				sendToStore(buf, node, name, typ).then((uri) => {
					let msg = [];
					if(uri && uri.toString) {
						msg.push("Download attachment:", uri.toString(), "");
					} else {
						msg.push("[Attachment removed]", "");
					}
					data.encoder.end(msg.join("\r\n"));
				}).catch((err) => {
					// we're not in a position to throw here; null message
					data.encoder.end(null);
				});
			});
		});

		return new Promise((resolve, reject) => {
			let message = [];
			joiner.on("data", (chunk) => {
				message.push(chunk);
			});
			joiner.on("end", () => {
				let msg = message.join("");
				if(msg) {
					resolve(message.join(""));
				} else {
					reject("store did not receive message");
				}
			});
			joiner.on("error", (err) => {
				reject(err);
			});
			// pipe a message source to splitter, then rewriter, then joiner
			s.pipe(splitter).pipe(rewriter).pipe(joiner);
		});
	}).then((newBody) => {
		res.setHeader("Content-Type", "text/plain");
		res.writeHead(200, "OK");
		res.end(newBody);
	}).catch((err) => {
		res.setHeader("Content-Type", "text/plain");
		res.writeHead(500, "Internal Error");
		res.end(err.toString());
	});
}



function recvFromStore(part, node) {
	return Promise.resolve().then(() => {
		let lines = part.split("\r\n");
		let link = "";
		lines.forEach((line) => {
			if(!line.indexOf("http")) {
				link = line.trim();
			}
		});

		let uri = url.parse(link);
		return new Promise((resolve, reject) => {
			let req = http.request({
				hostname: uri.hostname,
				port: uri.port,
				method: "GET",
				headers: {},
				path: uri.pathname
			}, function(res) {
				let data = [];
				res.on("data", function(chunk) {
					data.push(chunk);
				});
				res.on("end", function() {
					node.headers.add("Content-Disposition",
									 res.headers["content-disposition"]);
					node.headers.update("Content-Transfer-Encoding", "base64");
					node.encoding = "base64";
					node.setContentType(res.headers["content-type"]);

					console.log("restored: " + link);
					resolve(Buffer.concat(data)  // join up chunks
							.toString("base64")  // encode to base64
							.match(/.{1,74}/g)   // split into 76char wide
							.join("\r\n"));      // ...with \r\n between
				});
			});
			req.on("error", function(err) {
				console.error("failed to contact store");
				reject(err);
			});
			req.end();
		});
	});
}

export function recoverAttachments(req, res, next) {
	return Promise.resolve().then(() => {
		const s = new Readable();
		s.push(req.swagger.params.mime.value);
		s.push(null);

		let splitter = new Splitter();
		let joiner = new Joiner();
		let rewriter = new Rewriter((node) => {
			if(node.headers.getFirst("X-NetGovern-Detach")) {
				node.headers.remove("X-NetGovern-Detach");
				node.headers.remove("Content-Transfer-Encoding");
				node.encoding = "";
				return true;
			}
			return false;
		});
		rewriter.on("node", (data) => {
			let part = [];
			let node = data.node;
			node.headers.add("X-NetGovern-Detach-Recovered",
							 new Date().toISOString());
			data.decoder.on("data", (chunk) => {
				part.push(chunk);
			});
			data.decoder.on("end", () => {
				recvFromStore(part.join(""), node).then((b64blob) => {
					data.encoder.end(b64blob);
				}).catch((err) => {
					// we're not in a position to throw here; null message
					data.encoder.end(null);
				});
			});
		});

		return new Promise((resolve, reject) => {
			let message = [];
			joiner.on("data", (chunk) => {
				message.push(chunk);
			});
			joiner.on("end", () => {
				let msg = message.join("");
				if(msg) {
					resolve(message.join(""));
				} else {
					reject("did not recover message");
				}
			});
			joiner.on("error", (err) => {
				reject(err);
			});
			// pipe a message source to splitter, then rewriter, then joiner
			s.pipe(splitter).pipe(rewriter).pipe(joiner);
		});
	}).then((newBody) => {
		res.setHeader("Content-Type", "text/plain");
		res.writeHead(200, "OK");
		res.end(newBody);
	}).catch((err) => {
		res.setHeader("Content-Type", "text/plain");
		res.writeHead(500, "Internal Error");
		res.end(err.toString());
	});
}
