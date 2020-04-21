// The objects for storing client-proxy and proxy-server mappings

function Entities() {
  var self = this;
  this.servers = [];
  this.rooms = [];
  this.entities = [];
  
  // create new entity. First, it empty, exclude 
  this.addEntity = function(apiSec){
    var newEnt = new Entity(self.idGen(), apiSec);
    this.entities.push(newEnt);
    return newEnt;
  };
  this.genSenderIDExt = function(idSessionExt) {
    var ent = self.findBySessionIDExt(idSessionExt);
    if (ent) {
      if (ent.idSenderExt) return -1; // idSenderExt already exist, this is a strange situation and should be handled at the top level
      ent.idSenderExt = self.idGen(false);
      return ent;
    } else {
      return 0;
    }
  };
  this.findBySessionIDExt = function(id) {
    return self.entities.find(item => item.idSessionExt == id);
  };
  this.findBySenderIDExt = function(id) {
    return self.entities.find(item => item.idSenderExt == id);
  };
  this.findServerByRoom = function(room) {
    var ent = self.entities.find(item => item.room == room);
    return ent ? ent.server : "";
  };
  this.idGen = function(isSessionId = true) {
    const maxVal = Number.MAX_SAFE_INTEGER;
    const minVal = 1000000000000000;
    var idCandidate;
    do {
      idCandidate = minVal + Math.floor((maxVal - minVal) * Math.random());
      /*if (isSessionId) idCandidate = 2936192486478980;
      else idCandidate = 5962896525863409;*/
    } while (isSessionId ? self.findBySessionIDExt(idCandidate) : self.findBySenderIDExt(idCandidate));
    return idCandidate;
  };
}

function Entity(idSessionExt, apiSec) {
  this.idSessionExt = idSessionExt;
  this.idSessionInt = 0;
  this.idSenderExt = 0;
  this.idSenderInt = 0;
  this.apiSec = apiSec;
  this.server = "";
  this.room = 0;
  this.reqCache = [];
}

exports.Entities = Entities;
//exports.Entity = Entity;