/*jshint -W069 */

//var config = require('getconfig');
var https = require('https');
var fs = require('fs');
var express = require('express');
var bodyParser = require('body-parser');

var entities = require('./entity.js');
var logic = require('./logic.js');

var oEntities = new entities.Entities();
var oLogic = new logic.Logic(oEntities);

var httpsOpts = {
  key: fs.readFileSync('/etc/letsencrypt/live/proxy.kotpusk.ru/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/proxy.kotpusk.ru/cert.pem'),
};

var app = express();
var rt = express.Router();

rt.use(oLogic.rtLog);
rt.use('/janus/:idSession/:idSender', oLogic.rtMain);
rt.use('/janus/:idSession', oLogic.rtMain);
rt.use('/janus', oLogic.rtMain);
rt.use('/service', oLogic.rtService);
rt.use(oLogic.rtUnrouted);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
app.use(rt);

https.createServer(httpsOpts, app).listen(8889, function(){
  console.log('proxy listen 8889');
});


/*var newEnt = oEntities.addEntity('321');
console.log(newEnt);
newEnt = oEntities.setSenderIDExt(newEnt.idSessionExt);
console.log(newEnt);*/
