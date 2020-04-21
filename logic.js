/*jshint -W069 */

var colors = require('colors');
var fs = require('fs');
var axios = require('axios');
var https = require('https');

var httpsOpts = {
  key: fs.readFileSync('/etc/letsencrypt/live/proxy.kotpusk.ru/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/proxy.kotpusk.ru/cert.pem'),
};

var httpsAgent = new https.Agent(httpsOpts);

function Logic(entities) {
  var self = this;
  this.entities = entities;
  
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
        console.log(colors.yellow('received Create'));
        if (!self.checkReqCreate(req.body)) { self.actErrWrongReq(req, res); return; }
        entity = self.actCreate(req.body['apisecret']);
        self.actResponseCreate(res, entity);
        break;
      case 'attach':
        console.log(colors.yellow('received Attach'));
        if (!self.checkReqAttach(req.body, idSessionExt)) { self.actErrWrongReq(req, res); return; }
        entity = self.actAttach(idSessionExt);
        if (entity === -1) { self.actErrWrongReq(req, res, "idSenderExt already exist!"); return; }
        if (!entity) { self.actErrWrongReq(req, res, "entity not found!"); return; }
        self.actResponseAttach(res, entity);
        break;
      case 'message':
        console.log(colors.yellow('received Message: %s', req.body['body']['request']));
        if (self.checkReqMessage(req.body, idSessionExt, idSenderExt)) {
          var room;
          switch (req.body['body']['request']) {
            case 'listparticipants':
            case 'exists':
              room = req.body['body']['room'];
              var server = self.entities.findServerByRoom(room);
              entity = self.entities.findBySenderIDExt(idSenderExt);
              if (!entity) { self.actErrWrongReq(req, res, "entity not found!"); return; }
              if (!server) server = self.serverChoose();
              console.log(colors.yellow('Server interact start'));
              self.actStartServerInteract(entity, server, room);
              console.log(colors.yellow('Server interact finish'));
              self.actProcessReq(entity, req.method, idSessionExt, idSenderExt, req.body, req.query, res);
              break;
            default:
              console.log(colors.yellow('received another Message: (%s) %s'), req.method, req.url);
              console.log('DATA: ', req.body);
              console.log('QUERY: ', req.query);
              if (!idSessionExt) { self.actErrWrongReq(req, res); return; }
              entity = self.entities.findBySenderIDExt(idSenderExt);
              if (!entity) { self.actErrWrongReq(req, res, "entity not found!"); return; }
              self.actProcessReq(entity, req.method, idSessionExt, idSenderExt, req.body, req.query, res);
          }
        }
        break;
      default:
        console.log(colors.yellow('Another request received'));
        if (!idSessionExt) { self.actErrWrongReq(req, res); return; }
        entity = self.entities.findBySessionIDExt(idSessionExt);
        if (!entity) { self.actErrWrongReq(req, res, "entity not found!"); return; }
        self.actProcessReq(entity, req.method, idSessionExt, idSenderExt, req.body, req.query, res);
    }
  };
  
  // Generating of response to the client for the Create request
  this.actResponseCreate = function(res, entity) {
    console.log(colors.yellow('answered Create'));
    res.json({"janus": "success", "transaction": "Transaction", "data": { "id": entity.idSessionExt }});
  };
  // Generating of response to the client for the Attach request
  this.actResponseAttach = function(res, entity) {
    console.log(colors.yellow('answered Attach'));
    res.json({"janus": "success", "session_id": entity.idSessionExt, "transaction": "Transaction", "data": { "id": entity.idSenderExt }});
  };
  
  // Functions for checking requests parameters
  // TODO: I don't check the 'apisecret' in these functions
  this.checkReqCreate = function(strReq) {
    return strReq['janus']=='create' && strReq['transaction']=='Transaction' && strReq['apisecret'];
  };
  this.checkReqAttach = function(strReq, idSessionExt) {
    return strReq['janus']=='attach' && idSessionExt && strReq['plugin']=='janus.plugin.videoroom' && strReq['transaction']=='Transaction' && strReq['apisecret'];
  };
  this.checkReqMessage = function(strReq, idSessionExt, idSenderExt) {
    return strReq['janus']=='message' && idSessionExt && idSenderExt && strReq['body'] && strReq['transaction']=='Transaction' && strReq['apisecret'];
  };
  
  // Server selection function
  this.serverChoose = function() {
    return 'https://janus.kotpusk.ru:8889';
  };
  
  // Generating a response to a client in case of an erroneous request
  // TODO: It's necessary to remake the answer in the correct format with emulation of the answer Janus server
  this.actErrWrongReq = function(req, res, text = "") {
    if (!text) text = "\n"+text+"\n";
    console.log(colors.red('Wrong request: %s %s%s\n'), req.method, req.url, text, req.body);
    res.json({'error':'wrong request'});
  };
  // Adding a new client-server mapping entry (apisecret is required)
  this.actCreate = function(apiSec) {
    return self.entities.addEntity(apiSec);
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
      var url = entity.server+'/janus';
      if (idSessionExt) url = url + '/' + entity.idSessionInt;
      if (idSenderExt) url = url + '/' + entity.idSenderInt;
      console.log(colors.yellow('request proxying: (%s) idSessionExt: %s; idSenderExt: %s'), reqMethod, idSessionExt, idSenderExt);
      console.log('DATA: ', reqBody);
      console.log('QUERY: ', reqQuery);
      console.log('-------------------');
      console.log(entity);
      console.log('-------------------');
      switch (reqMethod) {
        case 'POST':
          axios.post(url, reqBody, httpsAgent)
            .then(function (respJanus) {
              if (respJanus.data.session_id) respJanus.data.session_id = entity.idSessionExt;
              if (respJanus.data.sender) respJanus.data.sender = entity.idSenderExt;
              res.json(respJanus.data);
            });
          break;
        case 'GET':
          axios.get(url, {'params': reqQuery}, httpsAgent)
            .then(function (respJanus) {
              if (respJanus.data.session_id) respJanus.data.session_id = entity.idSessionExt;
              if (respJanus.data.sender) respJanus.data.sender = entity.idSenderExt;
              res.json(respJanus.data);
            });
          break;
        default: 
      }
    } else {
      console.log(colors.yellow('request caching: (%s) idSessionExt: %s; idSenderExt: %s'), reqMethod, idSessionExt, idSenderExt);
      console.log('DATA: ', reqBody);
      console.log('QUERY: ', reqQuery);
      console.log('-------------------');
      console.log(entity);
      console.log('-------------------');
      var reqData = {"reqMethod": reqMethod, "idSessionExt": idSessionExt, "idSenderExt": idSenderExt, "reqBody": reqBody, "reqQuery": reqQuery, "res": res};
      entity.reqCache.push(reqData);
    }
  };
  
  // Sending accumulated client requests to the Janus server
  this.actProcessCacheReq = function(entity) {
    console.log(colors.yellow('cache process start'));
    while (entity.reqCache.length) {
      cachedReq = entity.reqCache.shift();
      self.actProcessReq(entity, cachedReq["reqMethod"], cachedReq["idSessionExt"], cachedReq["idSenderExt"], cachedReq["reqBody"], cachedReq["reqQuery"], cachedReq["res"]);
    }
    console.log(colors.yellow('cache process finish'));
  };
  
  // Real interaction with the Janus server after receiving the room number from the client and selecting the Janus server
  // After receiving session identifiers from the Janus server, we must send the accumulated client requests to the Janus server
  this.actStartServerInteract = function(entity, server, room) {
    entity.server = server;
    entity.room = room;
    var msgCreate = {"janus": "create", "transaction": "Transaction", "apisecret": entity.apiSec};
    console.log(colors.yellow('send Create'));
    console.log(msgCreate);
    axios.post(server+'/janus', msgCreate, httpsAgent)
      .then(function (respCreate) {
        console.log(colors.yellow('resp Create'));
        console.log(respCreate.data);
        idSessionInt = respCreate.data.data.id;
        entity.idSessionInt = idSessionInt;
        var msgAttach = {"janus": "attach", "plugin": "janus.plugin.videoroom", "transaction": "Transaction", "apisecret": entity.apiSec};
        console.log(colors.yellow('send Attach'));
        axios.post(server+'/janus/'+idSessionInt, msgAttach, httpsAgent)
          .then(function (respAttach) {
            console.log(colors.yellow('resp Attach'));
            console.log(respAttach.data);
            idSenderInt = respAttach.data.data.id;
            entity.idSenderInt = idSenderInt;
            self.actProcessCacheReq(entity);
          });
      });
  };
  
  this.rtUnrouted = function(req, res) {
    console.log(colors.red('Unhandled path: %s %s\n'), req.method, req.url, req.body);
    res.json({'error':'wrong path'});
  };
  this.rtLog = function(req, res, next) {
    console.log(colors.gray('--------------------------------'));
    console.log(colors.gray('Req: %s %s\n'), req.method, req.url, req.body);
    console.log(colors.gray('--                            --'));
    next();
  };
}

exports.Logic = Logic;