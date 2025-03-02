
module.exports = function(chat, web, cron) {
    cron.schedule('0 0 * * *', async () => {
        const to = '393200466987';
        const message = 'Bom dia!';
        const numberId = await chat.getNumberId(to);
        const sendMessage = await chat.sendMessage(numberId._serialized, message);
    });
}
