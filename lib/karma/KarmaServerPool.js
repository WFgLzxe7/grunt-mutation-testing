/**
 * KarmaServerManager class, containing functionality for managing a set of Karma servers. This includes the ability to
 * start new servers, and to shut them all down.
 *
 * @author Jimi van der Woning
 */
'use strict';

var _ = require('lodash'),
    log4js = require('log4js'),
    Q = require('q'),
    KarmaServer = require('./KarmaServerManager');

// Base port from which new server instances will connect
var logger = log4js.getLogger('KarmaServerManager'),
    port = 12111;


/**
 * Constructor for a Karma server manager
 *
 * @param config {object} Configuration object for the server.
 * @constructor
 */
function KarmaServerManager(config) {
    this._config = _.merge({ maxActiveServers: 5, startInterval: 100 }, config);
    this._instances = [];
}


/**
 * Get the list of active servers
 *
 * @returns {KarmaServer[]} The list of active Karma servers
 * @private
 */
KarmaServerManager.prototype._getActiveServers = function() {
    return _.filter(this._instances, function(instance) {
        return instance.isActive();
    });
};

/**
 * Start a new Karma server instance. Waits for other servers to shut down if more than config.maxActiveServers are
 * currently active. It will monitor the number of active servers on an interval of config.startInterval milliseconds.
 *
 * @param config {object} The configuration the new instance should use
 * @param runnerTimeUnlimited {boolean} if set the KarmaServerManager will not limit the running time of the runner
 * @returns {*|promise} A promise that will resolve with the new server instance once it has been started, and reject
 *                      if it could not be started properly
 */
KarmaServerManager.prototype.startNewInstance = function(config, runnerTimeUnlimited) {
    var self = this,
        deferred = Q.defer(),
        server = new KarmaServer(config, port++, runnerTimeUnlimited);

    function startServer() {
        if(self._getActiveServers().length < self._config.maxActiveServers) {
            deferred.resolve(server.start());
        } else {
            logger.trace('There are already %d servers active. Postponing start...', self._config.maxActiveServers);
            setTimeout(startServer, self._config.startInterval);
        }
    }

    this._instances.push(server);
    startServer();

    return deferred.promise;
};

/**
 * Stop all Karma server instances that have not been stopped already.
 */
KarmaServerManager.prototype.stopAllInstances = function() {
    _.forEach(this._instances, function(instance) {
        instance.isStopped() ? instance.stop() : _.identity();
    });
};

module.exports = KarmaServerManager;
