
module.exports = function(chat, web) {
    chat.on('message', msg => {
        if (msg.body === '/ping') {
            msg.reply('pong');
        }
    });
}
