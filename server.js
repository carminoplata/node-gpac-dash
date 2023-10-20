var http = require('http');
const fs = require("fs");



var LISTEN_ON_PORT = 3000;

function toTitleCase(str) {
    return str.replace(/[a-z]*/g, function(txt){return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();});
}

http.createServer(function (req, res) {
    var body;

    body = '';
    req.on('data', function(chunk) {
        body += chunk;
    });

    req.on('end', function() {
        console.log(req.method + ' ' + req.url + ' HTTP/' + req.httpVersion);

        if(req.method=="GET")
        {
            
            var binary = fs.readFileSync("data"+req.url);
            res.writeHead(200);
            res.write(binary);
            res.end();
        }

        for (prop in req.headers) {
            console.log(toTitleCase(prop) + ': ' + req.headers[prop]);
        }

        if (body.length > 0) {
            console.log('Write Segment Dash');
            /*if(req.url.endsWith('m4s'))
            {
                const ws = fs.createWriteStream("data"+req.url);
                ws.write(body);
                ws.end();
            }*/
            const ws = fs.createWriteStream("data"+req.url);
            ws.write(body);
            ws.end();
        }
        console.log('');

        res.writeHead(200);
        res.end();
    });

    req.on('err', function(err) {
        console.error(err);
    });
}).listen(LISTEN_ON_PORT, function () {
    console.log('Server listening on port ' + LISTEN_ON_PORT);
});