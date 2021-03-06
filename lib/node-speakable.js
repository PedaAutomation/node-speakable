var EventEmitter = require('events').EventEmitter,
    util = require('util'),
    spawn = require('child_process').spawn,
    http = require('http'),
    os = require('os');

var BINARIES = [];
BINARIES["win32-ia32"] = "sox_win.exe";
BINARIES["win32-x64"] = "sox_win.exe";
BINARIES["darwin-ia32"] = "sox_osx";
BINARIES["darwin-x64"] = "sox_osx";
BINARIES["linux-ia32"] = "sox_linux32";
BINARIES["linux-x64"] = "sox_linux64";
BINARIES["linux-arm"] = "sox_linuxarmhf";

var Speakable = function Speakable(credentials, options) {
  EventEmitter.call(this);

  options = options || {}

  this.recBuffer = [];
  this.recRunning = false;
  this.apiResult = {};
  this.apiLang = options.lang || "en-US";
  this.apiKey = credentials.key
  if(os.platform() === "linux") {
      this.cmd = "sox";
  } else {
    this.cmd = __dirname + '/binaries/' + BINARIES[os.platform() + '-' + os.arch()];
  }
  this.cmdArgs = [
    '-q',
    '-b','16',
    '-d','-t','flac','-',
    'rate','16000','channels','1',
    'silence','1','0.1',(options.threshold || '0.1')+'%','1','1.0',(options.threshold || '0.1')+'%'
  ];
};

util.inherits(Speakable, EventEmitter);
module.exports = Speakable;

Speakable.prototype.postVoiceData = function() {
  var self = this;

  var options = {
    hostname: 'www.google.com',
    path: '/speech-api/v2/recognize?client=chromium&key=' + self.apiKey + '&maxresults=1&lang=' + self.apiLang,
    method: 'POST',
    headers: {
      'Content-type': 'audio/x-flac; rate=16000'
    }
  };

  var req = http.request(options, function(res) {
    self.recBuffer = [];
    if(res.statusCode !== 200) {
      return self.emit(
        'error',
        'Non-200 answer from Google Speech API (' + res.statusCode + ')'
      );
    }
    res.setEncoding('utf8');
    res.on('data', function (chunk) {
      self.apiResult = JSON.parse(chunk);
    });
    res.on('end', function() {
      self.parseResult();
    });
  });

  req.on('error', function(e) {
    self.emit('error', e);
  });

  // write data to request body
  console.log('Posting voice data...');
  for(var i in self.recBuffer) {
    if(self.recBuffer.hasOwnProperty(i)) {
      req.write(new Buffer(self.recBuffer[i],'binary'));
    }
  }
  req.end();
};

Speakable.prototype.recordVoice = function() {
  var self = this;

  self.speechReady = false;
  var rec = spawn(self.cmd, self.cmdArgs, 'pipe');

  // Process stdout

  rec.stdout.on('readable', function() {
    if(self.speechReady) return;
    
    self.emit('speechReady');
    self.speechReady = true;
  });

  rec.stdout.setEncoding('binary');
  rec.stdout.on('data', function(data) {
    if(! self.recRunning) {
      self.emit('speechStart');
      self.recRunning = true;
    }
    self.recBuffer.push(data);
  });

  // Process stdin

  rec.stderr.setEncoding('utf8');
  rec.stderr.on('data', function(data) {
    console.log(data)
  });

  rec.on('close', function(code) {
    self.recRunning = false;
    if(code) {
      self.emit('error', 'sox exited with code ' + code);
    }
    self.emit('speechStop');
    self.postVoiceData();
  });
};

Speakable.prototype.resetVoice = function() {
  var self = this;
  self.recBuffer = [];
}

Speakable.prototype.parseResult = function() {
  var recognizedWords = [], apiResult = this.apiResult.result;
  
  if(apiResult && apiResult[0] && apiResult[0].alternative && apiResult[0].alternative[0]) {
    recognizedWords = apiResult[0].alternative[0].transcript.split(' ');
    this.emit('speechResult', recognizedWords);
  } else {
    this.emit('speechResult', []);
  }
}
