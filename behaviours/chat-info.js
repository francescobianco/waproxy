
module.exports = function(chat, web) {
    chat.on('message', async msg => {
        if (msg.body === '/info') {
            const messageChat = await msg.getChat()
            console.log("INFO:", msg)
            console.log("CHAT:", messageChat)
            msg.reply(
                "info\n"
            );
        }
    });
}
