
module.exports = function(chat, web, cron) {
    (async () => {
        const to = '393200466987';
        const numberId = await chat.getNumberId(to);
        const message = "Hello, I'm ready!";
        const sendMessage = await chat.sendMessage(numberId._serialized, message);
    })()
}
