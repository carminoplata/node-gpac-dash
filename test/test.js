

var assert = require('assert');
var fs = require('fs');
var httpMocks = require('node-mocks-http');
var expect = require('chai').expect;
var path = require('path')
var { storeStreaming }= require('../gpac-dash')
var { retrieveStreaming } = require('../gpac-dash');
var { makeChunk } = require('../gpac-dash');
var { deleteAll } = require('../gpac-dash');

var readFile = function(file){
  return fs.readFileSync(file);
}

var copyFiles = function(){
  files = fs.readdirSync('test/sample');
  files.forEach((file) => {
    fs.copyFileSync(path.join('test/sample', file),
                    path.join('data', file));
  });
}


describe('storeStreaming', function(){
  describe('using HLS', function(){
    //let res = httpMocks.createResponse();
    let expectedContent;
    let storedContent;
    //let filename;
    const streamingPieces = ['live.m3u8', 'live_1.m3u8', 'live_2.m3u8',
                             'video_track1__dashinit.mp4',
                             'video_track2__dashinit.mp4'];
    after(function(){
      streamingPieces.forEach((filename) => {
       fs.stat(`data/${filename}`, (err, stats) => {
         if(err) {
             console.warn(`File does not exist.${err}`);
         } else {
           fs.unlinkSync(`data/${filename}`);
         }
       });
      });
    });

    before(function(){
      streamingPieces.forEach((filename) => {
        if(fs.existsSync(`data/${filename}`))
        {
          console.log(`Delete ${filename}`);
          fs.unlinkSync(`data/${filename}`);
        }
      });
    });

    streamingPieces.forEach((filename) => {
      it(`store file ${filename}`, function(){
        console.log(filename);
        var req = httpMocks.createRequest({
          url:`/${filename}`,
          method:'PUT'
        });
        expectedContent =  readFile(`test/sample/${filename}`);
        return storeStreaming(req, expectedContent).then((code) => {
          expect(code).to.eq(200);
          console.log(`Check file data/${filename}`);
          storedContent = readFile(`data/${filename}`);
          return expect(storedContent).to.eql(expectedContent); // compare the content instead of the obj's reference
        });
      });
    });
    
    /*it('store HLS Playlist', function(){      
      var req = httpMocks.createRequest({
        url:'/live.m3u8',
        method:'PUT'
      });
      filename = 'live.m3u8'
      expectedContent =  readFile(`test/sample/${filename}`);
      return storeStreaming(req, expectedContent).then((code) => {
        expect(code).to.eq(200);
        storedContent = readFile(`data/${filename}`);
        return expect(storedContent).to.eql(expectedContent); // compare the content instead of the obj's reference
      });
    });*/
  });
});

describe('retrieveStreaming', function(){
  describe('using HLS', function(){
    const streamingPieces = ['live.m3u8', 'live_1.m3u8', 'live_2.m3u8', 
                             'video_track1__dashinit.mp4',
                             'video_track2__dashinit.mp4'];
    let expectedContent;
    streamingPieces.forEach((filename) => {
      beforeEach(function(){
        console.log(`Copy file ${filename} into data`);
        fs.copyFileSync(`test/sample/${filename}`, `data/${filename}`);
      });

      it(`retrieve file ${filename}`, function(){
        console.log(filename);
        var req = httpMocks.createRequest({
          url: `http://localhost:8000/${filename}`,
          method:'GET'
        });
        expectedContent =  readFile(`test/sample/${filename}`);
        return retrieveStreaming(req).then((obj) => {
          const {code, buffer} = obj;
          expect(code).to.eq(200);
          expect(buffer.length).to.eq(expectedContent.length);
          return expect(buffer).to.eql(expectedContent);
        });
        
        
      });
    });
  });
});

describe('makeChunk', function(){
  let buffer;
  let chunk_size;
  let expectedChunk;
  let chunk;
  this.beforeEach(function(){
    chunk_size = 0;

  });
  it('Buffer ciao', function(){
    buffer = Buffer.from('ciao', 'utf-8');
    // length of hexDigits size + 2 bytes CRLF + length data + 2 bytes CRLF + 1 byte last empty chunk + 4 bytes CRLFCRLF
    chunk_size = 14; 
    chunk = makeChunk(buffer);
    expectedChunk = Buffer.from('4\r\nciao\r\n0\r\n', 'utf-8');
    expect(chunk.length).to.eq(chunk_size);
    expect(chunk).to.eql(expectedChunk);
  });
  it('Buffer Video Init', function(){
    buffer = readFile('data/video_track1_dashinit.mp4');
    chunk_size = buffer.length.toString(16).length + buffer.length + 9;
    let chunked_size = Buffer.from(`${buffer.length.toString(16)}\r\n`,'utf-8');
    expectedChunk = Buffer.alloc(chunk_size);
    expectedChunk.set(chunked_size);
    expectedChunk.set(buffer, chunked_size.length);
    expectedChunk.set(Buffer.from('\r\n0\r\n\r\n', 'utf-8'), chunked_size.length + buffer.length);
    expect(chunk.length).to.eq(chunk_size);
    expect(chunk).to.eql(expectedChunk);
  })
});

describe('delete', function(){
  beforeEach(function(){
    copyFiles();
  });

  it('All Video', function(){
    return deleteAll().then((code) => {
      expect(code).to.eq(200);
      return expect(fs.readdirSync('data').length).to.eql(0);
    });
  })
});