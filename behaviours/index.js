const sayHelloToEveryone = require('./say-hello-to-everyone');

module.exports = function(client, app) {
    sayHelloToEveryone(client, app);
}
