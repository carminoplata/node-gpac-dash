/* 
 * Copyright (c) 2012-2013. Telecom ParisTech/TSI/MM/GPAC 
 * License: AGPL-3-Clause (see LICENSE file)
 *
 * NodeJS code to serve media content using DASH in low latency mode
 ******************************************************************************/

function usage() {
	console.log("node gpac-dash.js [options]");
	console.log("Basic options");
	console.log("-h                     displays this message");
	console.log("-log <level>           sets the log level: info (default) | debug-basic | debug-max");
	console.log("-ip <IP>               IP address of the server (default: all IP)");
	console.log("-port <port>           port of the server (default 8000)");
	console.log("-chunk-media-segments  send media segments asap using chunked transfer (default no)");
	console.log("-segment-marker <4cc>  marker for end of segment (default eods)");
	console.log("-no-marker-write       strip marker of the generated bitstream (default false)");
	console.log("-cors                  add CORS header for all domains")
	console.log("-use-watch             uses watch instead of watchFile (default: false)");
	console.log("-quality-log-file      name of a file in which the latest quality requested is logged (default: no log), experimental");
	console.log("-incoming-log-file     name of a file in which all requests are logged (default: no log)");
	console.log("-chunk-count			number of chunks in a segment");

	console.log();
}

function getNumOfHexDigits(number) {
	return Math.floor((Math.floor(Math.log2(number) + 1) / 4)+1);
}

function makeChunk(buffer){
	let chunk_size = `${buffer.length.toString(16)}\r\n`;
	let indexToFill = chunk_size.length;
	// Chunk : chunk_size_length + buffer + \r\n + 3 bytes empty chunk (0\r\n) + 2 bytes (\r\n)
	let chunk = Buffer.alloc(buffer.length + 7 + indexToFill); 
	let lastChunk = '\r\n0\r\n\r\n';
	chunk.set(Buffer.from(chunk_size, 'utf-8')); // start at index 0
	chunk.set(buffer, indexToFill);
	indexToFill+= buffer.length;
	chunk.set(Buffer.from(lastChunk, 'utf-8'), indexToFill);
	return chunk;
}

var fs = require('fs');
var http = require('http');
var path = require('path');
var url_parser = require('url');
const { log } = require('util');

var ipaddr = null;
var port = 8000;
var quality_log_file = null;
var incoming_log_file = null;
var logLevel = 0;
var chunkCount = 0;

/* Boolean controlling the sending of segments fragment-by-fragment as HTTP chunks, 
   requires MP4Box or DashCast to use -segment-marker eods */
var sendMediaSegmentsFragmented = false;
var SEGMENT_MARKER = "eods";
var no_marker_write = false;
var sendInitSegmentsFragmented = false;
var allowCors = false;
var use_watchFile = true;
var watchOptions = { persistent: true, recursive: false };
var watchFileOptions = { persistent: true, interval: 10 };

var retrieveStreaming = function(req){
	return new Promise((resolve, reject) => {
		var useIndex = false;
		var notFound = false;
		var fStat;
		var parsed_url = url_parser.parse(req.url, true);
		var filename = "data"+parsed_url.pathname;

		let ext; 
		let buffer;
		let result;
		if (incoming_log_file) {
			let recordLog = `Incoming request from ${req.socket.remoteAddress} for URL: ${req.url}
							 with headers: ${JSON.stringify(req.headers)}\n`;
			reportMessage(logLevels.INFO, recordLog);
		}
		if (quality_log_file) {
			fs.writeFile(quality_log_file, req.url);	
		}
		// we send the files as they come, except for segments for which we send fragment by fragment
		if (filename === "") {
			filename = "./";
		}
		try {	
			fStat = fs.statSync(filename);
		} catch(e) {
			notFound = true;
		}
		if (notFound || !fStat.isFile()) {
			if (fStat && fStat.isDirectory()) {
				var fIndexStat;
				try {	
					fIndexStat = fs.statSync(filename+require('path').sep+'index.html');
				} catch (e) {
					notFound = true;
				}
				if (fIndexStat) {
					notFound = false;
					useIndex = true;
				}
			} 
			if (notFound) {
				reportMessage(logLevels.INFO, "Request for non existing file: '" + filename);
				reject(404);
			}
		}else if(req.method == 'OPTIONS')
		{
			reportMessage(logLevels.INFO, "Request to access file: '" + filename);
			result = {code: 200, buffer:[]}
			resolve(result);
		}
		reportMessage(logLevels.INFO, "Request for file: '" + filename);
		if (parsed_url.pathname.endsWith('m3u8'))
		{
			ext = parsed_url.pathname.slice(-4);
		}else if(parsed_url.pathname.endsWith('mp4') || 
				 parsed_url.pathname.endsWith('m4s') ||
				 parsed_url.pathname.endsWith('mpd')){
		    ext = parsed_url.pathname.slice(-3);
		}else if(parsed_url.pathname.endsWith('ts')){
			ext = parsed_url.pathname.slice(-2);
		}
		if (ext in mime_types ) {
			// Retrieves full file
			buffer = sendFile(filename);
			/*if(ext == 'mp4' || ext =='m4s')
			{
				// HTTP 1.1 Chunks is {chunk_size}\r\n{chunk_data}\r\n0\r\n
				//result = {code: 200, ext: mime_types[ext], buffer: makeChunk(buffer)};
				result = {code: 200, ext: mime_types[ext], buffer: buffer};
			}else{
				result = {code: 200, ext: mime_types[ext], buffer: buffer};
			}*/
			result = {code: 200, ext: mime_types[ext], buffer: buffer};
			reportMessage(logLevels.INFO, `Sending File ${filename} with ${result.buffer.length} bytes`);
			resolve(result);
			/*if(ext != 'm4s' && ext != 'mp4'){
				
			}else
			{
				var params = new Parameters(false, state.NONE, res, filename);
			}*/
			
			// TODO: Check if we should send MP4 files as fragmented files or not
			/*if (ext === "mp4" && sendInitSegmentsFragmented || ext === "m4s" && sendMediaSegmentsFragmented && !filename.includes("init")) {
				var params = new Parameters(false, state.NONE, res, filename);
				sendFragmentedFile(res, filename, params);
				// Sending the final 0-size chunk because the file won't change anymore
				  if (ext === "mp4") {
					res.end();
					reportMessage(logLevels.INFO, "file " + filename + " sent in " + (getTime() - time) + " ms");
				  }
			} else { 
				sendFile(res, filename);
			}*/
		}else{
			reportMessage(logLevels.INFO, `Error Segment with ${ext} format doesn't exist`);
			reject(400);	
		}
	});
	
	
	

	// we send the files as they come, except for segments for which we send fragment by fragment
	/*if (filename === "") {
		filename = "./";
	}
	try {	
		fStat = fs.statSync(filename);
	} catch(e) {
		notFound = true;
	}
	if (notFound || !fStat.isFile()) {
		if (fStat && fStat.isDirectory()) {
			var fIndexStat;
			try {	
				fIndexStat = fs.statSync(filename+require('path').sep+'index.html');
			} catch (e) {
				notFound = true;
			}
			if (fIndexStat) {
				notFound = false;
				useIndex = true;
			}
		} 
		if (notFound) {
			reportMessage(logLevels.INFO, "Request for non existing file: '" + filename + "' at UTC " + time);
			
			return;
		}
	}else if(req.method == 'OPTIONS')
	{
		reportMessage(logLevels.INFO, "Request to access file: '" + filename + "' at UTC " + time);
		res.statusCode = 200;
		res.setHeader("Allow", "OPTIONS, GET");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
		res.end();
		return;
	}
	reportMessage(logLevels.INFO, "Request for file: '" + filename + "' at UTC " + time) ;
	
	if (ext === "mpd" || ext === "mp4" || ext === "m4s" || ext === "m3u8" ) {
		res.statusCode = 200;
		res.setHeader("Content-Type", mime_types[ext]);
		res.setHeader("Allow", time);
		// TODO: Check if we should send MP4 files as fragmented files or not
		if (ext === "mp4" && sendInitSegmentsFragmented || ext === "m4s" && sendMediaSegmentsFragmented && !filename.includes("init")) {
			var params = new Parameters(false, state.NONE, res, filename);
			sendFragmentedFile(res, filename, params);
			// Sending the final 0-size chunk because the file won't change anymore
      		if (ext === "mp4") {
				res.end();
				reportMessage(logLevels.INFO, "file " + filename + " sent in " + (getTime() - time) + " ms");
      		}
		} else { 
			sendFile(res, filename);
		}
	} else {
		if (useIndex) {
			sendFile(res, filename+require('path').sep+'index.html');
		} else {		
			sendFile(res, filename);
		}
	}*/
}

var retrieveSegmentFile = function(filename){
	var params = new Parameters(false, state.NONE, res, filename);
	sendFragmentedFile(res, filename, params);
}

var storeStreaming = function(req, content){

	return new Promise((resolve, reject) => {
		if (content.length <= 0)
		{
			reportMessage(`Received Empty chunk ${req.url}`)
			reject('Received empty file');
		}else{
			let flags = (req.url.endsWith('m3u8')|| req.url.endsWith('mpd')) ? {flags:'w'} : {flags:'a'};
			if(fs.existsSync("data"+req.url) && flags.flags=='a'){
				reportMessage(logLevel, `Add ${content.length} bytes at ${req.url}`);
			}else{
				reportMessage(logLevel, `Write Segment ${req.url} with ${content.length} bytes`);
			}
			let ws = fs.createWriteStream("data"+req.url, flags);
		    ws.write(content);
			ws.on('error', function(err){
				reportMessage(logLevel, `Error on writing file: ${err}`);
				reject('Error on writing');
			});
			ws.on('finish', () => {
				resolve(200);
			});
			ws.end();
		}
	});
	/*if (content.length > 0) {
		console.log('Write Segment '+ req.url + 'with size ' + content.length);
		const ws = fs.createWriteStream("data"+req.url, {flags:'a'});
    	ws.write(content, function(err){
			if(err){
				console.log("Error" + err);
			}else{
				console.log("Chunk completed");
			}
		});
    	ws.end();

		res.writeHead(200);
		res.end();
	}else
	{
		res.writeHead(400);
		res.end();
	}*/
	
};

var deleteAll = function(){
	return new Promise((resolve, reject) => {
		files = fs.readdirSync('data'); 
		if(files.length==0){
			reportMessage(logLevel, 'Not files inside data folder');
			reject(500)
		}else{
			files.forEach((file) => {
				const filePath = path.join('data', file);
				fs.unlinkSync(filePath);
			});
			resolve(200);
		}
	});
};

var deleteSegment = function(file){
	return new Promise((resolve, reject) => {
		let fileTarget = path.join('data', file);
		if(fs.existsSync(fileTarget)){
			fs.unlinkSync(fileTarget);
			resolve(200);
		}else{
			reportMessage(logLevel, `File ${fileTarget} Not Found`);
			resolve(400);
		}
	});
};

var logLevels = {
  INFO: 0,
  DEBUG_BASIC: 1,
  DEBUG_MAX: 2,
  ERROR: 3
};

var mime_types = {
	mp4: "video/mp4",
	m4s: "application/octet-stream",
	mpd: "application/dash+xml",
	m3u8: "application/vnd.apple.mpegurl",
	ts: "video/mp2t"
};

function pad(n, width, z) {
  z = z || '0';
  n = n + '';
  return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
}

function reportMessage(level, msg) {
	if (level <= logLevel) {
		var d = new Date();
		let recordLog = "[" + pad(d.getHours(), 2) + ":" + pad(d.getMinutes(), 2) +
						":" + pad(d.getSeconds(), 2) + "." + pad(d.getMilliseconds(), 3)+"] " + 
						msg + "\n";
		if(incoming_log_file)
		{
			fs.appendFile(incoming_log_file, recordLog, (err) => {
			   
				if(err)
				{
					console.log('Error' + err.code + ':' + err.message);
				}
				
			});	
		}else
		{
			console.log(recordLog);
		}
		
	}
}

/* returns the UTC time since the beginning of the year 
 *  should be using Date.now() but does not seem to work in NodeJS
 */
function getTime() {
	var d = new Date;
//	var n = (d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds())*1000 + d.getUTCMilliseconds();
	var n = d.getTime();
	return n; 
}

function reportEvent(type, event, filename){		
	var file_size = 0;
	/* need to check if the file exists because of file deletion (MP4Box and DashCast time-shift feature) */
	if (fs.existsSync(filename)) {
		var fd = fs.openSync(filename, 'r');
		file_size = fs.fstatSync(fd).size;
		fs.closeSync(fd);
	}
	reportMessage(logLevels.DEBUG_BASIC, type + " event (" + event + ") on "+filename+" (size "+file_size+")");
}

function sendAndUpdateBuffer(response, message, fileData, endpos, noWrite) {
	var tmpBuffer;
	fileData.total_sent += endpos;
	reportMessage(sendMediaSegmentsFragmented ? logLevels.INFO : logLevels.DEBUG_BASIC, 
		"sendMediaSegmentsFragmented: " + sendMediaSegmentsFragmented + " File "+fileData.filename+", sending "+message+" data from " + fileData.next_byte_to_send + " to " + (endpos - 1) + " in " + (getTime() - response.startTime) + " ms (total_sent: "+fileData.total_sent+") at utc "+ getTime());
	tmpBuffer = fileData.buffer.slice(fileData.next_byte_to_send, endpos);
	if (noWrite) {
		// patch for Google Chrome not supporting eods boxes
		// update buffer position but don't send the data
	} else {
		response.write(tmpBuffer);
	}
	fileData.nb_valid_bytes -= tmpBuffer.length;
	
	reportMessage(logLevels.DEBUG_MAX, "Resizing buffer - old length: " + fileData.buffer.length);
	fileData.buffer = fileData.buffer.slice(endpos);
	reportMessage(logLevels.DEBUG_MAX, "New buffer length:" + fileData.buffer.length);
	
	reportMessage(logLevels.DEBUG_MAX, "Resetting next offset for box reading and data sending");
	fileData.next_byte_to_send = 0;
	fileData.next_box_start = 0;
	
	fileData.write_offset -= endpos;
	reportMessage(logLevels.DEBUG_MAX, "Updating next buffer write offset: " + fileData.write_offset + ' - next 8 bytes:');

	if (logLevel == logLevels.DEBUG_MAX) console.log(fileData.buffer.slice(0,8));

	return fileData.buffer;
}

function readFileIntoBuffer(fileData) {
	var offset = fileData.write_offset;
	var buffer = fileData.buffer;
	var j = fileData.next_file_position;
	
	if (offset >= buffer.length) {
		/* increase the buffer size if we don't have enough to read in */
		buffer = Buffer.concat( [ buffer, Buffer.alloc(100000) ], buffer.length + 100000);						
		fileData.buffer = buffer;
	}

	reportMessage(logLevels.DEBUG_MAX, "Trying to read " + (buffer.length - offset) + " bytes from file from position: " + j);
	var bytesRead = fs.readSync(fileData.fd, buffer, offset, buffer.length - offset, j);
	reportMessage(logLevels.DEBUG_MAX, "bytesRead: " + bytesRead);
	if (logLevel == logLevels.DEBUG_MAX) console.log(buffer.slice(0,100));
	j = j + bytesRead;

	reportMessage(logLevels.DEBUG_MAX, "next file read position: " + j);

	fileData.next_file_position = j;
	fileData.write_offset += bytesRead;
	fileData.nb_valid_bytes += bytesRead ;
	
}

var state = {
	NONE : "none",
	MOOV : "moov",
	MOOF : "moof",
	MDAT : "mdat"
};

function readFromBufferAndSendBoxes(response, fileData) {
	var box_start = fileData.next_box_start;
	var buffer = fileData.buffer;

	reportMessage(logLevels.DEBUG_MAX, "Reading new box from buffer position: " + box_start + " - length: "+ buffer.length);
	if (logLevel == logLevels.DEBUG_MAX) console.log(buffer.slice(0,8));

	if (box_start + 8 > fileData.nb_valid_bytes) {
		reportMessage(logLevels.DEBUG_BASIC, "Not enough data in buffer to read box header: " + box_start + " - length: "+ buffer.length + " - nb valid bytes: " + fileData.nb_valid_bytes);
		return "not-enough";
	} 
	
	var boxLength = buffer.readUInt32BE(box_start);

	var val1 = String.fromCharCode(buffer.readUInt8(box_start + 4));
	var val2 = String.fromCharCode(buffer.readUInt8(box_start + 5));
	var val3 = String.fromCharCode(buffer.readUInt8(box_start + 6));
	var val4 = String.fromCharCode(buffer.readUInt8(box_start + 7));

	reportMessage(logLevels.DEBUG_BASIC, "Parsing box: code: " + val1 + val2 + val3 + val4 + " length: " + boxLength + " - parsing state: " + fileData.parsing_state);
	
	if (boxLength == 0) {
		reportMessage(logLevels.DEBUG_BASIC, "Box length 0, stopping parsing");
		return "stop";
	} 
  if (box_start + boxLength > fileData.nb_valid_bytes) {
		/*
		 * there is not enough data in the buffer to skip the box 
		 * coming back to the beginning of the box and
		 * exiting for new buffer allocation and additional read
		 * from file
		 */
		reportMessage(logLevels.DEBUG_MAX, "Not enough data in buffer to skip the box ("+box_start+"/"+fileData.nb_valid_bytes+")");
		fileData.next_box_start = box_start;
		reportMessage(logLevels.DEBUG_MAX, "Saving start position of the box for next read: " + fileData.next_box_start);
		return "not-enough";
	} 
  
  box_start += boxLength;
	fileData.next_box_start = box_start;
		
	if (val1 + val2 + val3 + val4 == SEGMENT_MARKER) {
		reportMessage(logLevels.DEBUG_BASIC, "**************** End of segment ****************");
		buffer = sendAndUpdateBuffer(response, "eods", fileData, fileData.next_box_start, no_marker_write);
		fileData.endOfSegmentFound = true;
		fileData.nbMdatInSegment = 0;
		return "end";
	}

	switch (fileData.parsing_state) {
	case "none":		
		if (val1 + val2 + val3 + val4 == "moov") {
			buffer = sendAndUpdateBuffer(response, "moov", fileData, fileData.next_box_start);
			fileData.parsing_state = state.MOOV; 
    } else if (val1 + val2 + val3 + val4 == "moof") {
			fileData.parsing_state = state.MOOF; 
		} else {
			/* wait for another box */
		}
		break;

	case "moov":
		if (val1 + val2 + val3 + val4 == "moof") {
			fileData.parsing_state = state.MOOF; 
		} else {
			/* wait for another box */
		}
		break;

	case "moof":
		if (val1 + val2 + val3 + val4 == "mdat") {
			buffer = sendAndUpdateBuffer(response, "mdat", fileData, fileData.next_box_start);
			fileData.nbMdatInSegment++;
			reportMessage(logLevels.INFO, "File "+fileData.filename+", fragment "+fileData.nbMdatInSegment+" sent at utc "+getTime());
			fileData.parsing_state = state.MOOV;
		} else {
			/* wait for another box */
		}
		break;
	}
	return "ok";			
}

function Parameters( multipleFiles, initial_state, response, filename) {
	this.buffer = Buffer.alloc(100000);
	this.parsing_state = initial_state;
	this.nb_valid_bytes = 0;
	this.next_file_position = 0;
	this.total_sent = 0;
	this.next_byte_to_send = 0;
	this.next_box_start = 0;
	this.write_offset = 0;
	this.request = false;
	this.checkEndOfSegment = multipleFiles;
	this.endOfSegmentFound = false;
	this.response = response;
	this.listener = null;
	this.endSent = false;
	this.filename = filename;
	this.nbMdatInSegment = 0;
}

function sendFragmentedFile(response, filename, params) {
	/* the change event may be for a file deletion */
	if (!fs.existsSync(filename)) {
		reportMessage(logLevels.DEBUG_MAX, "File filename does not exist");
		return;
	}

	let endReached = false;

	/* In some modes, we don't check for specific end of marker boxes */
	if (!params.checkEndOfSegment
		|| (params.checkEndOfSegment && params.endOfSegmentFound == false)
		// Sending the last chunk in the current segment
		|| (!params.checkEndOfSegment && params.endOfSegmentFound == true && params.nbMdatInSegment > 0)) {
		console.log("endOfSegmentFound: " + params.endOfSegmentFound);
		if (params.endOfSegmentFound == true && params.nbMdatInSegment > 0)
		{
			console.log("nbMdatInSegment: " + params.nbMdatInSegment);
			endReached = true;
		}

		params.fd = fs.openSync(filename, 'r');
		var stats = fs.fstatSync(params.fd);
		var file_size = stats.size;
		if (file_size <= params.next_file_position) {
			reportMessage(logLevels.DEBUG_MAX, "Error: file size hasn't changed or is smaller: " + file_size);
		}

		while (true) {
			/* If there is some data to read in the file, 
			   read it (from the position next_file_position) 
			   into the buffer (at the position write_offset)*/
			if (params.next_file_position < file_size) {
				readFileIntoBuffer(params);
			} 

			/* Read boxes and send them 
			   make sure we have at least 8 bytes to read box length and box code, 
			   otherwise we need to wait for the next read */
			boxReadingStatus = readFromBufferAndSendBoxes(response, params);				
			
			if (params.next_file_position < file_size) {
				console.log("we still have some data to read from the file");
				/* we still have some data to read from the file */
				continue;
			} else {
				/* we have read everything available from the file (for now) */
				if (boxReadingStatus == "ok") {
					console.log("we haven't finished reading boxes, keep on reading");

					if (params.nbMdatInSegment == chunkCount)
					{
						// When all chunks are read once (player is not requesting the live edge segment
						// chunk by chunk, but an earlier whole segment), readFromBufferAndSendBoxes 
						// returns "ok" but we should not wait for more MOOF, but end the current 
						// segment immediately.
						params.nbMdatInSegment = 0;
						endReached = true;
						break;
					}

					/* we haven't finished reading boxes, keep on reading */
					continue;
				} else if (boxReadingStatus == "not-enough") { 
					console.log("register watchFileListener 1");
					/* quit and wait for another file change event */
					reportMessage(logLevels.DEBUG_BASIC, "Not enough data to read the full box");
					if (params.listener == null) {
						if (use_watchFile) {
							params.listener = fs.watchFile(filename, watchFileOptions, watchFileListener.bind(params));
						} else {
							params.listener = fs.watch(filename, watchOptions, watchListener.bind(params));
						}
					}
					break;
				} else if (boxReadingStatus == "stop") {
					console.log("register watchFileListener 2");
					/* reset the parser, the data written in the file by GPAC/MP4Box is not ready to be read yet
					   quit and wait for another file change event */
					reportMessage(logLevels.DEBUG_BASIC, "Resetting parser - GPAC data not ready yet");
					params.next_file_position -= (params.nb_valid_bytes - params.next_box_start);
					reportMessage(logLevels.DEBUG_MAX, "Next file position is now "+params.next_file_position);
					params.write_offset -= (params.nb_valid_bytes - params.next_box_start);
					params.nb_valid_bytes = params.next_box_start;
					if (params.listener == null) {
						if (use_watchFile) {
							params.listener = fs.watchFile(filename, watchFileOptions, watchFileListener.bind(params));
						} else {
							params.listener = fs.watch(filename, watchOptions, watchListener.bind(params));
						}
					}
					break;
				} else if (boxReadingStatus == "end") {
										console.log("end reached because boxReadingStatus is end");
                                        reportMessage(logLevels.DEBUG_BASIC, "end reached");
                                        if (use_watchFile) {
                                                fs.unwatchFile(filename, params.listener);
                                        } else if (params.listener) {
                                                params.listener.close();
                                        }
                                        params.listener = null;
                                        /* Quit */
                                        break;
                                }
			}

            if (endReached)
            {
				params.nbMdatInSegment = 0;
              	reportMessage(logLevels.DEBUG_INFO, "end reached");
               	if (use_watchFile) {
                 	fs.unwatchFile(filename, params.listener);
                } 
				else if (params.listener) {
                    params.listener.close();
                }

                params.listener = null;
               	/* Quit */
                              
				break;
          	}
		}
		
		/* mark that the data from this file can be sent the next time its content will be refreshed 
		  (to send the very latest fragment first) */
		params.request = true;
		if (endReached) {
			console.log("sending 0-sized chunk");
			var resTime = getTime() - response.startTime;
			reportMessage(logLevels.INFO, "end of file reading ("+filename+") in " + resTime + " ms at UTC " + getTime() );
			params.response.end();
			params.endSent = true;
			/*if (params.listener) {
				params.listener.close();
			}*/
		}
		reportMessage(logLevels.DEBUG_MAX, " next file read position: " + params.next_file_position);
		reportMessage(logLevels.DEBUG_MAX, " buffer size: " + params.buffer.length);
		reportMessage(logLevels.DEBUG_MAX, " next buffer read position: " + params.next_box_start);
		reportMessage(logLevels.DEBUG_MAX, " next buffer write position: " + params.write_offset);
		reportMessage(logLevels.DEBUG_MAX, " next buffer send start position: " + params.next_byte_to_send);
		
		fs.closeSync(params.fd);
		
	}
}

/* Callback function used when an file event is generated, the file is sent in a fragmented manner 
 * The listener is not removed
 */
function watchListener(event, filename) {
	var boxReadingStatus;

	if (event == 'change') {
		reportEvent("file", event, filename);
		sendFragmentedFile(this.response, this.filename, this);
	}
	else {
		reportEvent("file", event, filename);
  }
}

function watchFileListener(curr, prev) {
	var boxReadingStatus;

	console.log("watchFileListener: nbMdatInSegment: " + this.nbMdatInSegment);	
	if (this.nbMdatInSegment + 1 == chunkCount)
	{
		this.endOfSegmentFound = true;
	}

	sendFragmentedFile(this.response, this.filename, this);
}

function sendFile(filename) {
	var useChunk = false;
	if (useChunk) {
		/*var file_stream = fs.createReadStream(filename);
		reportMessage(logLevels.DEBUG_BASIC, "Sending file ("+filename+")");
		file_stream.on("error", function(exception) {
			console.error("Error reading file ("+filename+")", exception);
		});
		file_stream.on("data", function(data) {
			res.write(data);
		});
		file_stream.on("close", function() {	
			reportMessage(logLevels.DEBUG_BASIC, "Done sending file ("+filename+")" + "in " + (getTime() - res.startTime) + " ms");
			res.end();
		});*/
	} else {
		/* Send the whole file using .end() to avoid using .write() because it uses chunk encoding
		   Use synchronous reading as they are small files (MPD and init) */
		return fs.readFileSync(filename);
		
	}
}

var onRequest = function(req, res) {
	if(req.method == 'GET' || req.method=='OPTIONS')
	{
		let content;
		var time = res.startTime = getTime();
		if(allowCors)
		{
			res.setHeader("Access-Control-Allow-Origin", "*");
			res.setHeader("Access-Control-Expose-Headers", "Date");
		}
		retrieveStreaming(req)
			.then((obj) => {
				if(obj.code == 200 && req.method=='OPTIONS')
				{
					res.statusCode = obj.code;
					res.setHeader("Allow", "OPTIONS, GET");
					res.setHeader("Access-Control-Allow-Headers", "Content-Type");
					res.end();
				}else if(obj.code==200 && obj.buffer.length > 0)
				{
					res.on('drain', () => {
						reportMessage(logLevels.INFO, `Transferred Chunk Completed. Get the next one`);
					});
					res.on('error', (err) => {
						reportMessage(logLevels.INFO, `Error sending ${req.url.pathname}: ${err}`);
					});
					reportMessage(logLevels.INFO, `Send File ${obj.ext} into Response`);
					res.statusCode = obj.code;
					res.setHeader("Content-Type", obj.ext);
					res.setHeader("Allow", time);
					
					if(obj.ext == mime_types['m3u8'] || obj.ext == mime_types['mpd'])
					{
						// See RFC-9112
						reportMessage(logLevels.INFO, 'Send Playlist or MPD File');
						res.setHeader('Content-Length', obj.buffer.length);
						
					}else
					{
						reportMessage(logLevels.INFO,  `Send Chunks of ${obj.buffer.length} bytes`);
						//res.setHeader('Transfer-Encoding', 'chunked');
					}
					let responseSent = res.write(obj.buffer);
					
					if (responseSent)
					{
						reportMessage(logLevels.INFO, `Bytes ${obj.buffer.length} are transferred`);
					}else{
						reportMessage(logLevels.INFO, `Bytes ${obj.buffer.length} are queued`);
					}
					res.end();
				}else{
					reportMessage(logLevels.INFO, `File ${req.url.pathname} EMPTY OR NOT FOUND`);
					res.writeHead(obj.code);
					res.end();
				}
			})
			.catch((err) => {
				if(err==404)
				{
					res.statusCode = 404;
					res.end(`Piece of Streaming ${req.url.pathname} not found`);
				}
			});
	}else if(req.method =='DELETE'){

		let reqPath = url_parser.parse(req.url, true).pathname;

		if(reqPath == '/'){
			reportMessage(logLevels.INFO, `DELETE all video files`);
			deleteAll().then((code) => {
				reportMessage(logLevels.DEBUG_BASIC, `200 OK ${req.url}`);
				res.writeHead(200);
				res.end();
			}).catch((msg) => {
				reportMessage(logLevel,`Client Error: ${msg}`);
				res.writeHead(500);
				res.end();
			});
		}else{
			reportMessage(logLevels.INFO, `DELETE ${reqPath}`);
			deleteSegment(reqPath).then((code) => {
				if(code==200){
					reportMessage(logLevels.DEBUG_BASIC, `200 OK ${req.url}`);
				}else{
					reportMessage(logLevels.DEBUG_BASIC, `${code} ${req.url}`);
				}
				res.writeHead(code);
				res.end();
			}).catch((msg) => {
				reportMessage(logLevel,`Client Error: ${msg}`);
				res.writeHead(500);
				res.end();
			});
		}
	}else
	{
    	req.on('data', function(chunk) {
        	storeStreaming(req, chunk)
				.then((code) =>{
					reportMessage(logLevels.DEBUG_BASIC, `200 OK ${req.url}`);
				})
				.catch((msg) => {
					console.log(`Client Error: ${msg}`);
					res.writeHead(400);
					res.end()
				});
    	});

		req.on('end', function() {
        	reportMessage(logLevels.DEBUG_BASIC, 'Chunk Completed');
			res.writeHead(200);
			res.end();
    	});
		
		req.on('err', function(err) {
			console.error(err);
			reportMessage(logLevels.ERROR, err);
			res.writeHead(400);
			res.write('BadRequest: Error from client');
			res.end();
		});
	}
}

process.argv.splice(1).forEach(function(val, index, array) {
	// console.log(index + ': ' + val + " / " + array[index + 1]);
	if (index == 0) {
		reportMessage(logLevels.INFO, "Runnning " + val +" using "+process.execPath+" version "+process.version+" in "+process.cwd());
	}
	if (val === "-ip") {
		ipaddr = array[index + 1];
	} else if (val === "-port") {
		port = parseInt(array[index + 1], 10);
	} else if (val === "-log") {
		if (array[index + 1] === "info") {
			logLevel = logLevels.INFO;
		} else if (array[index + 1] === "debug-basic") {
			logLevel = logLevels.DEBUG_BASIC;
		} else if (array[index + 1] === "debug-max") {
			logLevel = logLevels.DEBUG_MAX;
		}
	} else if (val === "-timing") {
		logTiming = true;
	} else if (val === "-segment-marker") {
		SEGMENT_MARKER = array[index + 1];
	} else if (val === "-no-marker-write") {
		no_marker_write = true;
	} else if (val === "-chunk-media-segments") {
		sendMediaSegmentsFragmented = true;
	} else if (val === "-cors") {
		allowCors = true;
	} else if (val === "-use-watch") {
		use_watchFile = false;
	} else if (val === "-quality-log-file") {
		quality_log_file = array[index + 1];
	} else if (val === "-incoming-log-file") {
		incoming_log_file = array[index + 1];
		console.log("log file: " + incoming_log_file);
	} else if (val === "-chunks-per-segment") {
		chunkCount = array[index + 1];
		console.log("chunkCount: " + chunkCount);		
	} else if (val === "-h") {
		usage();
		process.exit(-1);
	}
});

if (ipaddr) {
	http.createServer(onRequest).listen(port, ipaddr);	
} else {
	http.createServer(onRequest).listen(port);
}
var initMsg = "Server running on " + (ipaddr ? ipaddr + ":" + port : "port "+ port+ " on all IP ") + "in "
			+ (process.env.NODE_ENV ==='production' ? + "Production ": "Development ") + "with " 
			+ (sendMediaSegmentsFragmented ? "low-latency": "normal ")+" mode ";
reportMessage(logLevels.INFO, initMsg);

module.exports = { storeStreaming, retrieveStreaming, makeChunk, deleteAll };