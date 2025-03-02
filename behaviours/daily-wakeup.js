
module.exports = function(chat, web, cron) {
    cron.schedule('* * * * *', () => {
        console.log("TEST")
    });
}
