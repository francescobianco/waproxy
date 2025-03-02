
const { MessageMedia } = require('whatsapp-web.js');

module.exports = function(chat, web, cron) {
    cron.schedule('* * * * *', async () => {
        const to = '393200466987';
        const numberId = await chat.getNumberId(to);
        const positionUrl = 'https://chessboardimage.com/rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R%20b%20KQkq%20-%201%202.png'
        const media = await MessageMedia.fromUrl(positionUrl);
        const sendMessage = await chat.sendMessage(numberId._serialized, media);
    });
}
