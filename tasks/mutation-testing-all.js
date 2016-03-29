'use strict';

var CopyUtils = require('../utils/CopyUtils'),
    path = require('path'),
    _ = require('lodash'),
    nodeunit = require('nodeunit'),
    TestStatus = require('../lib/TestStatus'),
    log4js = require('log4js'),
    logger = log4js.getLogger('mutation-testing-all'),
    Promise = require('bluebird'),
    glob = require("glob"),
    globAsync = Promise.promisify(glob);

Promise.longStackTraces();
var cp = require("child_process");
var fs = Promise.promisifyAll(require("fs"));
var fsExtra = require('fs-extra');
var newProcess;

function runAsync(execStr, timeout, tmpDir) {
    return new Promise(function(resolve, reject) {
        var stdout = [];
        var stderr = [];
        var elements = execStr.split(/\s+/g);
        var command = elements.shift();
        var args = elements;

        logger.info("spawning command: " + command + ", args: " + args + ", cwd: " + tmpDir);
        newProcess = cp.spawn(command, args, {cwd: tmpDir});
        newProcess.stdout.on("data", function(buffer) {
            process.stdout.write(buffer);
            stdout.push(buffer);
        });
        newProcess.stderr.on("data", function(buffer) {
            process.stderr.write(buffer);
            stderr.push(buffer);
        });
        newProcess.on("close", function(code) {
            stdout = Buffer.concat(stdout).toString("utf8");
            stderr = Buffer.concat(stderr).toString("utf8");
            if (code === 0) {
                resolve({
                    stdout: stdout,
                    stderr: stderr
                });
            } else {
                var error = new Error(execStr + " exited with failure code: " + code);
                error.stdout = stdout;
                error.stderr = stderr;
                error.command = execStr;
                reject(error);
            }
        });
    }).timeout(timeout)
    .catch(function(e) {
        newProcess.kill("SIGKILL");
        e.command = execStr;
        throw e;
    });
}



exports.init = function(grunt, opts) {
    if(opts.testFramework === 'karma') {
        return;
    }

    var commandLineOptMutate = grunt.option("mutationTest:options:mutate");
    var commandLineOptCode = grunt.option("mutationTest:options:code");
    var commandLineOptCodeAdditional = grunt.option("mutationTest:options:code:additional");
    var commandLineOptCodeExcl = grunt.option("mutationTest:options:excludeMutations");
    var commandLineOptCodeSymlinks = grunt.option("mutationTest:options:symlinks");
    var commandLineOptTimeout = grunt.option("mutationTest:options:timeout") || 20000;
    var commandLineOptLogLevel = grunt.option("mutationTest:options:logLevel");

    if(commandLineOptLogLevel){
        opts.logLevel = commandLineOptLogLevel;
        logger.info('Overriding opts.logLevel with %s', opts.logLevel);
    };

    var originalBasePath = process.cwd();
    var tmpBasePath;

    if(commandLineOptMutate){
        opts.mutate = grunt.file.expand(commandLineOptMutate);
        logger.info('Overriding opts.mutate with %s', opts.mutate);
    };

    if(commandLineOptCode){
        opts.code = grunt.file.expand(commandLineOptCode);
        logger.info('Overriding opts.code with %s', opts.code);
    };

    if(commandLineOptCodeExcl){
        opts.excludeMutations = JSON.parse(commandLineOptCodeExcl);
        logger.info('Overriding opts.excludeMutations with %s', commandLineOptCodeExcl);
    };

    if(commandLineOptCodeSymlinks){
        opts.symlinks = JSON.parse(commandLineOptCodeSymlinks);
        logger.info('Overriding opts.symlinks with %s', commandLineOptCodeSymlinks);
    };

    if(commandLineOptCodeAdditional){
        commandLineOptCodeAdditional = commandLineOptCodeAdditional.split(',');
        commandLineOptCodeAdditional.forEach(function(minimatchExpr){
            var expanded = grunt.file.expand(minimatchExpr);
            logger.info('Appending opts.code with %s', expanded);
            opts.code = opts.code.concat(expanded);
        })
        logger.info('Overriding opts.code with %s', opts.code);
    };

    logger.info('Setting timeout for each single test %dms', commandLineOptTimeout);


    function expandSpecs() {
        var specPattern = grunt.option("mutationTest:options:specs") || "test/**/*.js";
        specPattern = specPattern.split(',');
        var globResult = [];
        specPattern.forEach(function(minimatchExpr) {
            var expanded = grunt.file.expand(minimatchExpr);
            globResult = globResult.concat(expanded);
        })

        return Promise
            .join()
            .return(globResult);
    }

    var expandedSpecs = expandSpecs();

    function runTests(specs, tmpDir){
        return specs.each(function(file) {
            var p = path.join(tmpDir, file);
            if(p.search("Mocha.js") === -1) {
                var command = path.join(tmpDir, "node_modules", "nodeunit", "bin", "nodeunit") + " --reporter minimal "
            }
            else {
                command = path.join(tmpDir, "node_modules", "@nokia", "builder", "node_modules", ".bin", "mocha") + " -b ";
            }

            return runAsync(command + p, commandLineOptTimeout, tmpDir);
        });
    }

    opts.before = function(doneBefore) {
        if(opts.mutateProductionCode) {
            tmpBasePath = originalBasePath;
            runTests(expandedSpecs, originalBasePath)
            .then(function(){
                doneBefore();
            }).catch(function(error) {
                logger.error(error + '. Tests don\'t pass without mutations!');
                process.exit(-1);
            });
        } else {
            // Find which files are used in the unit test such that they can be copied
            CopyUtils.copyToTemp(opts.code.concat(opts.specs), 'mutation-testing')
            .done(function(tempDirPath) {
                tmpBasePath = tempDirPath;
                logger.trace('Copied %j to %s', opts.code.concat(opts.specs), tempDirPath);

                // create symlinks in tmpDirPath, if set
                if (opts.symlinks) {
                    opts.symlinks.forEach(function(folder) {
                        var srcPath = path.resolve(path.join(opts.basePath, folder));
                        var tgtPath = path.join(tempDirPath, folder);
                        fs.symlinkSync(srcPath, tgtPath);
                        logger.info('Created symbolic link: %s -> %s', srcPath, tgtPath);
                    })
                };

                // Set the basePath relative to the temp dir
                opts.basePath = path.join(tempDirPath, opts.basePath);

                // Set the paths to the files to be mutated relative to the temp dir
                opts.mutate = _.map(opts.mutate, function(file) {
                    return path.join(tempDirPath, file);
                });

                runTests(expandedSpecs, tempDirPath).then(function(){
                    doneBefore();
                })
                .catch(function(error) {
                    logger.error(error + '. Tests don\'t pass without mutations!');
                    process.exit(-1);
                });
            });
        }
    };

    opts.test = function(done) {
        runTests(expandedSpecs, tmpBasePath).then(function(){
            done(TestStatus.SURVIVED);
        })
        .catch(function(error) {
            done(TestStatus.KILLED);
        });
    };
}
