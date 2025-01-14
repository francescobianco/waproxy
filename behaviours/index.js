const sayHelloToEveryone = require('./say-hello-to-everyone');
const replyToPing = require('./reply-to-ping');

module.exports = function(chat, web) {
    sayHelloToEveryone(chat, web);
    replyToPing(chat, web);
}
