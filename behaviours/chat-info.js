
module.exports = function(chat, web) {
    chat.on('message', msg => {
        if (msg.body === '/info') {
            console.log("INFO:", msg)
            console.log("CHAT:", msg.getChat())
            msg.reply(
                "info\n"
            );
        }
    });
}
