
module.exports = function(chat, web) {
    chat.on('message', msg => {
        if (msg.body === '/info') {
            console.log("INFO:", msg)
            msg.reply(
                "info\n"
            );
        }
    });
}
