import * as cluster from 'cluster';
import * as url from 'url';
import * as fs from 'fs';
import * as st from 'serve-static';
import * as jsonrpc from '@akala/json-rpc-ws';
import * as ws from 'ws';
import * as akala from '@akala/core';
import { relative, sep as pathSeparator, dirname, join as pathJoin } from 'path';
import { serveRouter } from './master-meta';
import * as debug from 'debug';
// import * as $ from 'underscore';
import { EventEmitter } from 'events';
import { router, Request, Response, CallbackResponse } from './router';
import * as pac from './package';
var log = debug('akala:master');
var orchestratorLog = debug('akala:master:orchestrator');
import * as Orchestrator from 'orchestrator';
import * as sequencify from 'sequencify';
import { microservice } from './microservice';
import { updateConfig, getConfig } from './config';

var httpPackage: 'http' | 'https';
if (!fs.existsSync('privkey.pem') || !fs.existsSync('fullchain.pem'))
    httpPackage = 'http'
else
    httpPackage = 'https';

var master = new EventEmitter();
master.setMaxListeners(Infinity);

var port = process.env.PORT || '5678';

if (process.execArgv && process.execArgv.length >= 1)
    process.execArgv[0] = process.execArgv[0].replace('-brk', '');



akala.register('$updateConfig', new Proxy(updateConfig, {
    get: function (uc, key: string)
    {
        return function (config, subKey)
        {
            return uc(config, key + '.' + subKey);
        }
    }
}));
akala.registerFactory('$config', new Proxy(getConfig, {
    get: function (c, key: string)
    {
        return function ()
        {
            return c().then(function (config) { return config[key]; });
        }
    }
}));

var lateBoundRoutes = router();
var preAuthenticatedRouter = router();
var authenticationRouter = router();
var app = router();
akala.register('$preAuthenticationRouter', preAuthenticatedRouter);
akala.register('$authenticationRouter', authenticationRouter);
akala.register('$router', lateBoundRoutes);
var masterRouter = router();
masterRouter.use(preAuthenticatedRouter.router);
masterRouter.use(authenticationRouter.router);
masterRouter.use(lateBoundRoutes.router);
masterRouter.use(app.router);

var configFile = fs.realpathSync('./config.json');
var sourcesFile = fs.realpathSync('./sources.list');
var orchestrator = new Orchestrator();
orchestrator.onAll(function (e)
{
    if (e.src == 'task_not_found')
        console.error(e.message);
    if (e.src == 'task_err')
        console.error(e.err);

    orchestratorLog(e);
});

interface Connection extends jsonrpc.Connection
{
    submodule?: string;
}

var socketModules: { [module: string]: Connection } = {};
var modulesEvent: { [module: string]: EventEmitter } = {};
var globalWorkers = {};
var modulesDefinitions: { [name: string]: sequencify.definition } = {};
var root: string;

fs.exists(configFile, function (exists)
{
    var config = exists && require(configFile) || {};

    root = config && config['@akala/server'] && config['@akala/server'].root;
    port = config && config['@akala/server'] && config['@akala/server'].port || port;
    var dn = config && config['@akala/server'] && config['@akala/server'].dn || 'localhost';

    fs.readFile(sourcesFile, 'utf8', function (error, sourcesFileContent)
    {
        var sources: string[] = [];
        var tmpModules: string[] = [];
        if (error && error.code == 'ENOENT')
        {
            var pkg: pac.CoreProperties = require(pathJoin(process.cwd(), './package.json'))
            var [source, folder] = pkg.name.split('/');
            microservice(folder, pkg.name, source, [source], config, modulesDefinitions, modulesEvent, orchestrator, preAuthenticatedRouter, globalWorkers, app, master, socketModules, httpPackage + '://' + dn + ':' + port, tmpModules);
        }
        else
        {
            sources = JSON.parse(sourcesFileContent);
        }
        akala.eachAsync(sources, function (source, i, next)
        {
            fs.readdir('node_modules/' + source, function (err, modules)
            {
                if (err)
                {
                    console.error(err);
                    return;
                }

                modules.forEach(function (folder)
                {
                    microservice(folder, source + '/' + folder, source, sources, config, modulesDefinitions, modulesEvent, orchestrator, preAuthenticatedRouter, globalWorkers, app, master, socketModules, httpPackage + '://' + dn + ':' + port, tmpModules);
                });

                next();
            });
        }, function (error?)
            {
                if (error)
                {
                    console.error(error);
                    return;
                }

                var modules = tmpModules;
                akala.register('$$modules', modules);
                akala.register('$$socketModules', socketModules);
                // akala.register('$$sockets', sockets);
                log(modules);

                var masterDependencies = [];
                akala.each(modules, function (e)
                {
                    masterDependencies.push(e + '#master');
                });

                orchestrator.add('@akala/server#master', function () { });

                orchestrator.add('default', masterDependencies, function ()
                {
                    master.emit('ready');
                    log('registering error handler');

                    app.get('*', function (request, response)
                    {
                        if (request.url.endsWith('.map'))
                        {
                            response.sendStatus(404);
                        }
                        fs.createReadStream(root + '/index.html').pipe(response);
                    });

                    masterRouter.use(function (err, req: Request, res: Response, next)
                    {
                        try
                        {
                            if (err)
                            {
                                console.error('error occurred on ' + req.url);

                                console.error(err.stack);
                                res.statusCode = 500;
                                res.write(JSON.stringify(err));
                                res.end();
                            }
                            else
                                res.sendStatus(404);
                        }
                        catch (e)
                        {
                            console.error(e.stack)
                            res.statusCode = 500;
                            res.end();
                        }
                    });
                    console.log('server ready...');
                });

                orchestrator.start('default');
            });
    });

    if (httpPackage == 'http')
    {
        const http = require('http');
        var server = http.createServer();
    }
    else
    {
        const https = require('https');
        var server = https.createServer({ key: fs.readFileSync('privkey.pem'), cert: fs.readFileSync('fullchain.pem') });
    }
    // var server = http2.createSecureServer({ allowHTTP1: true, key: fs.readFileSync('priv.pem'), cert: fs.readFileSync('fullchain.pem') });
    server.listen(port, dn);
    masterRouter.attachTo(server);
});

