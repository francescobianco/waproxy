let _manager = null;

module.exports = {
    set(m) { _manager = m; },
    get() { return _manager; }
};
