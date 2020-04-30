/*jshint -W069 */

//var config = require('getconfig');
var https = require('https');
var fs = require('fs');
var express = require('express');
var bodyParser = require('body-parser');
var config = require('getconfig');

var logic = require('./logic.js');

var oLogic = new logic.Logic();

var httpsOpts = {
  key: fs.readFileSync(config.proxy.key, 'utf8'),
  cert: fs.readFileSync(config.proxy.cert, 'utf8'),
};

var app = express();
var rt = express.Router();

rt.use(oLogic.rtLog);
rt.use('/janus/:idSession/:idSender', oLogic.rtMain);
rt.use('/janus/:idSession', oLogic.rtMain);
rt.use('/janus', oLogic.rtMain);
rt.use('/v1/service', oLogic.rtService);
rt.use('/v1/status', oLogic.rtStatus);
rt.use(oLogic.rtUnrouted);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
app.use(rt);

https.createServer(httpsOpts, app).listen(8889, function(){
  console.log('proxy listen 8889');
});

