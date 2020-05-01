/*jshint -W069 */

var colors = require('colors');
var fs = require('fs');
var axios = require('axios');
var https = require('https');
var config = require('getconfig');

var entities = require('./entity.js');
var servers = require('./server.js');
var jalog = require('./jalog.js');

var httpsOpts = {
  key: fs.readFileSync(config.proxy.key, 'utf8'),
  cert: fs.readFileSync(config.proxy.cert, 'utf8'),
};

var httpsAgent = new https.Agent(httpsOpts);

function Logic() {
  var self = this;
  this.entities = new entities.Entities();
  this.servers = new servers.Servers();
  this.jalog = new jalog.Jalog();
  this.cntCreate = 0;
  
  // Main client request processor
  // If the beginning of a new session is detected (Create and Attach requests), the response to the request is generates independently,
  // without actually sending the request to the Janus server. All other requests are cached until a Message request with a room number is received.
  // Upon receiving the room number in the Message request, the Janus server is selected and a connection is established with it,
  // after which all cached requests are sent
  this.rtMain = function(req, res) {
    var idSessionExt = req.params['idSession'];
    var idSenderExt = req.params['idSender'];
    var jAct = req.body['janus'];
    var entity;
    switch (jAct) {
      case 'create':
        ++self.cntCreate;
        console.log(colors.yellow('%s received Create #%d'), self.jalog.textTime(), self.cntCreate);
        self.jalog.log(self.cntCreate, 'cl->pr', 'received Create');
        if (!self.checkReqCreate(req.body)) { self.actErrWrongReq(req, res); return; }
        // TODO: req.body['apisecret'] must checked
        entity = self.actCreate(self.cntCreate);
        self.actResponseCreate(res, entity);
        break;
      case 'attach':
        console.log(colors.yellow('%s received Attach (SessionExt: %s)'), self.jalog.textTime(), idSessionExt);
        if (!self.checkReqAttach(req.body, idSessionExt)) { self.actErrWrongReq(req, res); return; }
        entity = self.actAttach(idSessionExt);
        if (entity === -1) { self.actErrWrongReq(req, res, "idSenderExt already exist!"); return; }
        if (!entity) { self.actErrWrongReq(req, res, "entity not found!"); return; }
        self.jalog.log(entity.idx, 'cl->pr', 'received Attach');
        self.actResponseAttach(res, entity);
        break;
      case 'message':
        // Need to process exit room
        console.log(colors.yellow('%s received Message: '+req.body['body']['request']+' (SessionExt: %s; SenderExt: %s)'), self.jalog.textTime(), idSessionExt, idSenderExt);
        if (!self.checkReqMessage(req.body, idSessionExt, idSenderExt)) { self.actErrWrongReq(req, res); return; }
        entity = self.entities.findBySenderIDExt(idSenderExt);
        if (!entity) { self.actErrWrongReq(req, res, "entity not found!"); return; }
        self.jalog.log(entity.idx, 'cl->pr', 'received Message:', req.body);
        if (!entity.room && (req.body['body']['request'] == 'listparticipants' || req.body['body']['request'] == 'exists')) {
          var room = req.body['body']['room'];
          var server = self.entities.findServerByRoom(room);
          if (!server) server = self.servers.serverChoose();
          console.log(colors.yellow('Server selected: ', server.url));
          self.jalog.log(entity.idx, 'info', 'Server selected: '+server.url);
          self.jalog.log(entity.idx, 'info', 'Start server interact');
          self.actStartServerInteract(entity, server, room);
        }
        self.actProcessReq(entity, req.method, idSessionExt, idSenderExt, req.body, req.query, res);
        break;
      default:
        console.log(colors.yellow('%s received request %s (SessionExt: %s; SenderExt: %s)'), self.jalog.textTime(), jAct, idSessionExt, idSenderExt);
        if (!idSessionExt) { self.actErrWrongReq(req, res); return; }
        entity = self.entities.findBySessionIDExt(idSessionExt);
        if (!entity) { self.actErrWrongReq(req, res, "entity not found!"); return; }
        self.jalog.log(entity.idx, 'cl->pr', 'received request:('+req.method+')', (req.method=='GET'?req.query:req.body));
        self.actProcessReq(entity, req.method, idSessionExt, idSenderExt, req.body, req.query, res);
    }
  };
  
  // Generating of response to the client for the Create request
  this.actResponseCreate = function(res, entity) {
    console.log(colors.yellow('%s answered Create #%d (SessionExt: %d)'), self.jalog.textTime(), entity.idx, entity.idSessionExt);
    self.jalog.log(entity.idx, 'cl<-pr', 'sent Create');
    res.json({"janus": "success", "transaction": "Transaction", "data": { "id": entity.idSessionExt }});
  };
  // Generating of response to the client for the Attach request
  this.actResponseAttach = function(res, entity) {
    console.log(colors.yellow('%s answered Attach #%d (SessionExt: %d; SenderExt: %d)'), self.jalog.textTime(), entity.idx, entity.idSessionExt, entity.idSenderExt);
    self.jalog.log(entity.idx, 'cl<-pr', 'sent Attach');
    res.json({"janus": "success", "session_id": entity.idSessionExt, "transaction": "Transaction", "data": { "id": entity.idSenderExt }});
  };
  // Something went wrong and need to send an info about it
  this.actResponseErrorHungup = function(entity) {
    entity.isDead = true;
    console.log(colors.yellow('%s start emergency cache processing #%d'), self.jalog.textTime(), entity.idx);
    self.jalog.log(entity.idx, 'info', 'Start emergency cache processing');
    while (entity.reqCache.length) {
      cachedReq = entity.reqCache.shift();
      self.actProcessReq(entity, cachedReq["reqMethod"], cachedReq["idSessionExt"], cachedReq["idSenderExt"], cachedReq["reqBody"], cachedReq["reqQuery"], cachedReq["res"]);
    }
    console.log(colors.yellow('%s cache emergency processing complete #%d'), self.jalog.textTime(), entity.idx);
  };
  
  // Functions for checking requests parameters
  // TODO: I don't check the 'apisecret' value in these functions
  this.checkReqCreate = function(strReq) {
    return strReq['janus']=='create' && strReq['transaction']=='Transaction' && strReq['apisecret'];
  };
  this.checkReqAttach = function(strReq, idSessionExt) {
    return strReq['janus']=='attach' && idSessionExt && strReq['plugin']=='janus.plugin.videoroom' && strReq['transaction']=='Transaction' && strReq['apisecret'];
  };
  this.checkReqMessage = function(strReq, idSessionExt, idSenderExt) {
    return strReq['janus']=='message' && idSessionExt && idSenderExt && strReq['body'] && strReq['transaction']=='Transaction' && strReq['apisecret'];
  };
  
  // Generating a response to a client in case of an erroneous request
  // TODO: It's necessary to remake the answer in the correct format with emulation of the answer Janus server
  this.actErrWrongReq = function(req, res, text = "") {
    if (!text) text = "\n"+text;
    console.log(colors.red('Wrong request: %s %s%s\n'), req.method, req.url, text, req.body);
    console.log('-'.repeat(60));
    res.json({'error':'wrong request'});
  };
  // Adding a new client-server mapping entry (apisecret is required)
  this.actCreate = function(idx) {
    return self.entities.addEntity(idx);
  };
  // Generating a SenderID for an existing client-server mapping entry
  this.actAttach = function(idSessionExt) {
    return self.entities.genSenderIDExt(idSessionExt);
  };
  
  // Client request processing function
  // If the procedure for establishing communication with the Janus server has not yet been performed, the request is cached
  // Otherwise, we immediately redirect the request to the Janus server with the replacement of SessionID and SenderID,
  // and assign a callback function that sends a response to the client
  this.actProcessReq = function(entity, reqMethod, idSessionExt, idSenderExt, reqBody, reqQuery, res) {
    if (entity.server && entity.idSessionInt && entity.idSenderInt) {
      var locCntReq = ++entity.cntReq;
      var srv = entity.server;
      if (entity.isDead) {
        locCntReq = ++entity.cntReq;
        srv = entity.server;
        console.log(colors.red('request #%d.%d discarded - %s is dead'), entity.idx, locCntReq, srv.url);
        self.jalog.log(entity.idx, 'pr->cl', 'request #'+locCntReq+' discarded - '+srv.url+' is dead');
        var respData = {"janus": "hangup", "session_id": idSessionExt, "sender": idSenderExt, "reason": "Janus goes down"};
        // Need to send it once, after this send (illegal sessionID) or empty answer
        res.json(respData);
        return;
      }
      var url = srv.url+'/janus';
      if (idSessionExt) url = url + '/' + entity.idSessionInt;
      if (idSenderExt) url = url + '/' + entity.idSenderInt;
      if ('apisecret' in reqBody) reqBody['apisecret'] = srv.apiSec;
      console.log(colors.yellow('request #%d.%d proxying to %s: (%s) idSessionExt: %s; idSenderExt: %s'), entity.idx, locCntReq, srv.url, reqMethod, idSessionExt, idSenderExt);
      console.log('DATA: ', reqBody);
      console.log('QUERY: ', reqQuery);
      console.log('-'.repeat(60));
      self.jalog.log(entity.idx, 'pr->sr', 'sending request #'+locCntReq+':('+reqMethod+')', (reqMethod=='GET'?reqQuery:reqBody));
      switch (reqMethod) {
        case 'POST':
          axios.post(url, reqBody, httpsAgent)
            .then(function (respJanus) {
              if (respJanus.data.session_id) respJanus.data.session_id = entity.idSessionExt;
              if (respJanus.data.sender) respJanus.data.sender = entity.idSenderExt;
              console.log(colors.yellow('response #%d.%d proxying from %s'), entity.idx, locCntReq, srv.url);
              console.log(self.jalog.conv(respJanus.data));
              console.log('-'.repeat(60));
              self.jalog.log(entity.idx, 'sr->pr', 'resp to request #'+locCntReq+':('+reqMethod+')', respJanus.data);
              res.json(respJanus.data);
            }).catch(function (error) {
              console.log(colors.red('response #%d.%d - Error communicate server %s'), entity.idx, locCntReq, srv.url);
              console.log(colors.red(error.message));
              self.jalog.log(entity.idx, 'sr->pr', 'resp to request #'+locCntReq+':ERROR! ('+reqMethod+')', error.message);
              res.json(error.data);
            });
          break;
        case 'GET':
          axios.get(url, {'params': reqQuery}, httpsAgent)
            .then(function (respJanus) {
              if (respJanus.data.session_id) respJanus.data.session_id = entity.idSessionExt;
              if (respJanus.data.sender) respJanus.data.sender = entity.idSenderExt;
              console.log(colors.yellow('response #%d.%d proxying from %s'), entity.idx, locCntReq, srv.url);
              console.log(self.jalog.conv(respJanus.data));
              console.log('-'.repeat(60));
              self.jalog.log(entity.idx, 'sr->pr', 'resp to request #'+locCntReq+':('+reqMethod+')', respJanus.data);
              res.json(respJanus.data);
            }).catch(function (error) {
              console.log(colors.red('response #%d.%d - Error communicate server %s'), entity.idx, locCntReq, srv.url);
              console.log(colors.red(error.message));
              self.jalog.log(entity.idx, 'sr->pr', 'resp to request #'+locCntReq+':ERROR! ('+reqMethod+')', error.message);
              res.json(error.data);
            });
          break;
        default: 
      }
    } else {
      console.log(colors.yellow('request caching: (%s) idSessionExt: %s; idSenderExt: %s'), reqMethod, idSessionExt, idSenderExt);
      console.log('DATA: ', reqBody);
      console.log('QUERY: ', reqQuery);
      console.log('-'.repeat(60));
      self.jalog.log(entity.idx, 'cache', 'received request:('+reqMethod+')', (reqMethod=='GET'?reqQuery:reqBody));
      var reqData = {"reqMethod": reqMethod, "idSessionExt": idSessionExt, "idSenderExt": idSenderExt, "reqBody": reqBody, "reqQuery": reqQuery, "res": res};
      entity.reqCache.push(reqData);
    }
  };
  
  // Sending accumulated client requests to the Janus server
  this.actProcessCacheReq = function(entity) {
    console.log(colors.yellow('%s start cache processing #%d'), self.jalog.textTime(), entity.idx);
    self.jalog.log(entity.idx, 'info', 'Start cache processing');
    while (entity.reqCache.length) {
      cachedReq = entity.reqCache.shift();
      self.actProcessReq(entity, cachedReq["reqMethod"], cachedReq["idSessionExt"], cachedReq["idSenderExt"], cachedReq["reqBody"], cachedReq["reqQuery"], cachedReq["res"]);
    }
    console.log(colors.yellow('%s cache processing completed #%d'), self.jalog.textTime(), entity.idx);
  };
  
  // Real interaction with the Janus server after receiving the room number from the client and selecting the Janus server
  // After receiving session identifiers from the Janus server, we must send the accumulated client requests to the Janus server
  this.actStartServerInteract = function(entity, server, room) {
    entity.server = server;
    server.bindEntity(entity);
    entity.room = room;
    var msgCreate = {"janus": "create", "transaction": "Transaction", "apisecret": server.apiSec};
    console.log(colors.yellow('%s Srv send Create #%d (SessionExt: %d; SenderExt: %d) to %s'),
                self.jalog.textTime(), entity.idx, entity.idSessionExt, entity.idSenderExt, server.url);
    console.log(msgCreate);
    console.log('+'.repeat(60));
    self.jalog.log(entity.idx, 'pr->sr', 'send Create');
    axios.post(server.url+'/janus', msgCreate, httpsAgent)
      .then(function (respCreate) {
        self.jalog.log(entity.idx, 'sr->pr', 'resp Create:', respCreate.data);
        try {
          idSessionInt = respCreate.data.data.id;
        } catch(e) {
          console.log(colors.red(e));
          idSessionInt = 0;
        }
        console.log(colors.yellow('%s Srv resp Create #%d (SessionExt->SessionInt: %d->%d) from %s'), self.jalog.textTime(), entity.idx, entity.idSessionExt, idSessionInt, server.url);
        console.log(respCreate.data);
        console.log('+'.repeat(60));
        // TODO: check response and process possible errors
        entity.idSessionInt = idSessionInt;
        var msgAttach = {"janus": "attach", "plugin": "janus.plugin.videoroom", "transaction": "Transaction", "apisecret": server.apiSec};
        console.log(colors.yellow('%s Srv send Attach #%d (SessionExt: %d; SenderExt: %d) to %s'), self.jalog.textTime(), entity.idx, entity.idSessionExt, entity.idSenderExt, server.url);
        console.log(msgAttach);
        console.log('+'.repeat(60));
        self.jalog.log(entity.idx, 'pr->sr', 'send Attach');
        axios.post(server.url+'/janus/'+idSessionInt, msgAttach, httpsAgent)
          .then(function (respAttach) {
            self.jalog.log(entity.idx, 'sr->pr', 'resp Attach:', respAttach.data);
            try {
              idSenderInt = respAttach.data.data.id;
            } catch(e) {
              console.log(colors.red(e));
              idSenderInt = 0;
            }
            console.log(colors.yellow('%s Srv resp Attach #%d (SenderExt->SenderInt: %d->%d) from %s'), self.jalog.textTime(), entity.idx, entity.idSenderExt, idSenderInt, server.url);
            console.log(respAttach.data);
            console.log('+'.repeat(60));
            // TODO: check response and process possible errors
            entity.idSenderInt = idSenderInt;
            entity.isDead = false;
            console.log('-- Entity #%d data --', entity.idx);
            console.log(entity);
            console.log('-'.repeat(60));
            self.jalog.log(entity.idx, 'info  ', 'Entity formed:', entity);
            self.actProcessCacheReq(entity);
          }).catch(function (error) {
            console.log(colors.red('Error communicate server: attach phase'));
            console.log(colors.red(error.message));
            self.jalog.log(entity.idx, 'sr->pr', 'resp Attach ERROR:', error.message);
            self.actReselectionServer(entity);
          });
      }).catch(function (error) {
        console.log(colors.red('Error communicate server: create phase'));
        console.log(colors.red(error.message));
        self.jalog.log(entity.idx, 'sr->pr', 'resp Create ERROR:', error.message);
        self.actReselectionServer(entity);
      });
  };
  
  // If there was a failure in communication with Janus server at the initial phase
  this.actReselectionServer = function(entity) {
    var room = entity.room;
    // TODO!!! Exclude this entity!
    if (self.entities.findServerByRoom(room)) actResponseErrorHungup(entity);
    else {
      entity.server.setServerDead();
      var server = self.servers.serverChoose();
      console.log(colors.yellow('Server reselected: ', server.url));
      self.jalog.log(entity.idx, 'info', 'Server reselected: '+server.url);
      self.jalog.log(entity.idx, 'info', 'Start server interact');
      self.actStartServerInteract(entity, server, room);
    }
  };
  
  this.rtUnrouted = function(req, res) {
    console.log(colors.red('Unhandled path: %s %s\n'), req.method, req.url, req.body);
    res.json({'error':'wrong path'});
  };
  this.rtLog = function(req, res, next) {
    var sTime = self.jalog.textTime();
    console.log(colors.gray('%s ---- Log client request ----------------------------'), sTime);
    console.log(colors.gray('Req: %s %s\n'), req.method, req.url, req.body);
    console.log(colors.gray('-'.repeat(sTime.length+53)));
    next();
  };
  
  this.rtService = function(req, res) {
    console.log('-- All Entities data --');
    console.log(self.entities);
    console.log('-'.repeat(60));
    var srvs = [];
    for (let i=0; i<self.servers.servers.length; i++) {
      let iSrv = self.servers.servers[i];
      let ents = [];
      for (let j=0; j<iSrv.entities.length; j++) {
        let ent = iSrv.entities[j];
        let iEnt = { idx: ent.idx, cntReq: ent.cntReq, server: ent.server.url, room: ent.room, isDead: ent.isDead, reqCache: ent.reqCache.length };
        ents.push(iEnt);
      }
      let srv = { url: iSrv.url, entities: ents, cpu: iSrv.cpu, ram: iSrv.ram, hdd: iSrv.hdd, isDead: iSrv.isDead};
      srvs.push(srv);
    }
    res.json(srvs);
  };

  this.rtStatus = function(req, res) {
    var servers = [];
    //TODO: Make it iterable!
    for (var server of self.servers.servers) {
      let srv = { server: server.url, cpu: server.cpu, memory: server.ram, hdd: server.hdd, rooms: []};
      for (let i=0; i<server.entities.length; i++) {
        let ent = server.entities[i];
        let room = srv.rooms.find(item => item.id == ent.room);
        if (!room) {
            room = { id: ent.room, users: []};
            srv.rooms.push(room);
        }
        room.users.push(ent.idSessionExt);
      }
      servers.push(srv);
    }
    res.json(servers);
  };

}

exports.Logic = Logic;