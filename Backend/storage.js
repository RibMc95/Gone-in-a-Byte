const { createOracleStorage } = require("./oracleStorage");

function createStorage() {
    return createOracleStorage();
}

module.exports = {
    createStorage,
};