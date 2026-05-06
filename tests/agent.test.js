const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const agentModule = require('../behaviours/agent');

function makeChat(sent) {
    return {
        getNumberId: async (to) => ({ _serialized: `${to}@c.us` }),
        sendMessage: async (to, message) => {
            sent.push({ to, message });
            return { to, message };
        }
    };
}

async function waitFor(predicate) {
    for (let i = 0; i < 20; i++) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}

describe('Agent scheduling', () => {
    test('memo di invio puntuale viene eseguito senza passare dal modello', async () => {
        const sent = [];
        agentModule.setChat(makeChat(sent));

        const agent = agentModule.getFor('393200466987');
        agent.scheduleNext('Invia esattamente questo testo: "5"');

        await waitFor(() => sent.length === 1);

        assert.deepEqual(sent, [{ to: '393200466987@c.us', message: '5' }]);
    });

    test('memo con prossimo invio da countdown non prolifera nuove schedulazioni', async () => {
        const sent = [];
        agentModule.setChat(makeChat(sent));

        const agent = agentModule.getFor('393200466988');
        agent.scheduleNext('Countdown da 5 a 1: inviato 5. Prossimo: invia esattamente "4"');

        await waitFor(() => sent.length === 1);

        assert.deepEqual(sent, [{ to: '393200466988@c.us', message: '4' }]);
        assert.equal(agent._queue.length, 0);
    });

    test('memo terminale esplicito viene trattato come sola azione di invio', async () => {
        const sent = [];
        agentModule.setChat(makeChat(sent));

        const agent = agentModule.getFor('393200466989');
        agent.scheduleNext('AZIONE TERMINALE: invia esattamente questo testo: "3" e non schedulare altro');

        await waitFor(() => sent.length === 1);

        assert.deepEqual(sent, [{ to: '393200466989@c.us', message: '3' }]);
        assert.equal(agent._queue.length, 0);
    });
});
