
module.exports = function(chat, web) {
    web.post('/send', async (req, res) => {
        const to = req.query.to;
        const message = String(req.body);
        try {
            const numberId = await chat.getNumberId(to);
            const sendMessage = await chat.sendMessage(numberId._serialized, message);
            console.log("SENT", sendMessage)
        } catch (error) {
            console.log("ERROR", error)
        }
        res.send('Ok!'+"\n")
    })
}
