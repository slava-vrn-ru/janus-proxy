var config = require('getconfig');
var io = require('socket.io-client');
var WebSocketClient = require('websocket').client;

function Servers() {
  var self = this;
  this.servers = [];

  this.init = function() {
    for (let i=0; i<config.janus.length; i++) {
      if (!config.janus[i].enabled) continue;
      let srv = new Server(config.janus[i]);
      this.servers.push(srv);
    }
    for (let i=0; i<self.servers.length; i++) {
      const s = self.servers[i];
      console.log('Try to connect: %s', s.responder);
      const socketResponder = io(s.responder);
      s.socketResponder = socketResponder;
      socketResponder.on('status', function(data) {
        //console.log('Data received for %s\n', s.url);
        s.cpu = Number(data.data.cpu);
        s.ram = Number(data.data.ram);
        s.hdd = Number(data.data.hdd);
      });
      socketResponder.on('connect', function(data) {
        console.log('Media server responder connected: %s', s.responder);
        if (s.idTimer) clearInterval(s.idTimer);
        setInterval(() => {
          socketResponder.emit('status');
        }, 2000);
      });
      socketResponder.on('disconnect', function(data) {
        console.log('Disconnect: ', s.responder);
        s.cpu = Number.MAX_SAFE_INTEGER; s.ram = Number.MAX_SAFE_INTEGER; s.hdd = Number.MAX_SAFE_INTEGER;
        s.idTimer = setInterval(() => {
          console.log('Try to REconnect: %s', s.responder);
          socketResponder.connect(s.responder);
        }, 5000);
      });
      
      const socketEndpoint = new WebSocketClient();
      s.socketEndpoint = socketEndpoint;
      socketEndpoint.on('connectFailed', function(error) {
        console.log('Janus connect Error: ' + error.toString());
      });
      socketEndpoint.on('connect', function(connection) {
        console.log('Janus is alive: %s', s.url);
        s.setServerAlive();
        connection.on('close', data => {
          console.log('Janus is dead: %s', s.url);
          s.setServerDead();
        });
      });
      setInterval(() => {
        if (s.isDead) socketEndpoint.connect(s.endpoint, 'janus-protocol');
      }, 3000);
    }
    
  };
 
   // Server selection function
  this.serverChoose = function() {
    //self.servers.sort((a, b) => a.cpu > b.cpu ? 1 : -1);
    var srv = self.servers.shift();
    self.servers.push(srv);
    //return self.servers[0];
    return srv;
  };
  
  this.findServerByURL = function(srvURL) {
    return self.servers.find(item => item.url == srvURL);
  };
  
  this.init();

}

function Server(config_elem) {
  var self = this;
  this.url = config_elem.host;
  this.apiSec = config_elem.apiSecret;
  this.responder = config_elem.responder;
  this.endpoint = config_elem.endpoint;
  this.entities = [];
  this.socketResponder = undefined;
  this.socketEndpoint = undefined;
  this.cpu = Number.MAX_SAFE_INTEGER;
  this.ram = Number.MAX_SAFE_INTEGER;
  this.hdd = Number.MAX_SAFE_INTEGER;
  this.isDead = true;
  
  this.bindEntity = function(entity) {
    self.entities.push(entity);
  };
  
  this.setServerDead = function() {
    self.isDead = true;
    self.cpu = Number.MAX_SAFE_INTEGER;
    self.ram = Number.MAX_SAFE_INTEGER;
    self.hdd = Number.MAX_SAFE_INTEGER;
    for (let i=0; i<self.entities.length; i++) {
      self.entities[i].isDead = true;
    }
  };
  this.setServerAlive = function() {
    self.isDead = false;
    for (let i=0; i<self.entities.length; i++) {
      self.entities[i].isDead = false;
    }
  };
}

exports.Servers = Servers;