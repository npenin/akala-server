import * as akala from '@akala/core'
import * as jsonrpc from 'json-rpc-ws'
import * as master from '../master-meta'
import * as router from '../router'
import { createServer } from './jsonrpc'
import { Proxy } from '@akala/core'
import { Metadata as Meta } from '@akala/core'

var log = akala.log('akala:metadata');

export function createServerFromMeta<
    TConnection extends jsonrpc.Connection,
    TServerOneWay,
    TServerTwoWay,
    TClientOneWay,
    TClientTwoWay,
    TServerOneWayProxy extends TServerOneWay,
    TServerTwoWayProxy extends TServerTwoWay,
    TClientOneWayProxy extends TClientOneWay,
    TClientTwoWayProxy extends TClientTwoWay>(meta: Meta<TConnection, TServerOneWay, TServerTwoWay, TClientOneWay, TClientTwoWay, TServerOneWayProxy, TServerTwoWayProxy, TClientOneWayProxy, TClientTwoWayProxy>)
{
    return function (router: router.HttpRouter, path: string, serverImpl: TServerOneWay & TServerTwoWay): TServerOneWay & TServerTwoWay & Partial<TClientOneWay & TClientTwoWay>
    {
        log('creating server on ' + path);
        var server = createServer<TConnection>(router, path);

        meta.serverOneWayKeys.forEach(function (serverKey)
        {
            server.expose(serverKey, function (params)
            {
                log('receiving ' + serverKey + ' with %o', params);
                (<any>serverImpl[serverKey])(params, this);
            })
        });

        meta.serverTwoWayKeys.forEach(function (serverKey)
        {
            server.expose(serverKey, function (params, reply)
            {
                log('receiving ' + serverKey + ' with %o', params);
                akala.Promisify<any>((<any>serverImpl[serverKey])(params, this)).then(function (result)
                {
                    reply(null, result);
                }, function (reason)
                    {
                        reply(reason);
                    });
            });
        });

        meta.clientOneWayKeys.forEach(function (clientKey: any)
        {
            if (!serverImpl[clientKey])
                serverImpl[clientKey] = <any>function (params)
                {
                    log('sending ' + clientKey + ' with %o', params);
                    server.send(clientKey, params);
                }
        });

        meta.clientTwoWayKeys.forEach(function (clientKey: any)
        {
            if (!serverImpl[clientKey])
                serverImpl[clientKey] = <any>function (params, callback)
                {
                    var deferred = new akala.Deferred();
                    log('sending ' + clientKey + ' with %o', params);
                    server.send(clientKey, params, callback);
                    return deferred;
                }
        });

        serverImpl['$proxy'] = (socket: TConnection) => { return meta.createClientProxy(socket); };

        return <any>serverImpl;
    }
}
export function createServerFromDualMeta<
    TConnection extends jsonrpc.Connection,
    TServerOneWay,
    TServerTwoWay,
    TClientOneWay,
    TClientTwoWay,
    TServerOneWayProxy extends TServerOneWay,
    TServerTwoWayProxy extends TServerTwoWay,
    TClientOneWayProxy extends TClientOneWay,
    TClientTwoWayProxy extends TClientTwoWay,
    TOConnection extends jsonrpc.Connection,
    TOServerOneWay,
    TOServerTwoWay,
    TOClientOneWay,
    TOClientTwoWay,
    TOServerOneWayProxy extends TOServerOneWay,
    TOServerTwoWayProxy extends TOServerTwoWay,
    TOClientOneWayProxy extends TOClientOneWay,
    TOClientTwoWayProxy extends TOClientTwoWay>(meta1: Meta<TConnection, TServerOneWay, TServerTwoWay, TClientOneWay, TClientTwoWay, TServerOneWayProxy, TServerTwoWayProxy, TClientOneWayProxy, TClientTwoWayProxy>,
    meta2: Meta<TOConnection, TOServerOneWay, TOServerTwoWay, TOClientOneWay, TOClientTwoWay, TOServerOneWayProxy, TOServerTwoWayProxy, TOClientOneWayProxy, TOClientTwoWayProxy>)
{
    return function (router: router.HttpRouter, path: string, serverImpl: TServerOneWay & TServerTwoWay, serverImpl2: TOServerOneWay & TOServerTwoWay): TServerOneWay & TServerTwoWay & Partial<TClientOneWay & TClientTwoWay>
        & TOServerOneWay & TOServerTwoWay & Partial<TOClientOneWay & TOClientTwoWay>
    {
        return createServerFromMeta(new DualMetadata(meta1, meta2))(router, path, akala.extend(serverImpl, serverImpl2));
    }
}

export class DualMetadata<

    TConnection extends jsonrpc.Connection,
    TServerOneWay,
    TServerTwoWay,
    TClientOneWay,
    TClientTwoWay,
    TServerOneWayProxy extends TServerOneWay,
    TServerTwoWayProxy extends TServerTwoWay,
    TClientOneWayProxy extends TClientOneWay,
    TClientTwoWayProxy extends TClientTwoWay,

    TOConnection extends jsonrpc.Connection,
    TOServerOneWay,
    TOServerTwoWay,
    TOClientOneWay,
    TOClientTwoWay,
    TOServerOneWayProxy extends TOServerOneWay,
    TOServerTwoWayProxy extends TOServerTwoWay,
    TOClientOneWayProxy extends TOClientOneWay,
    TOClientTwoWayProxy extends TOClientTwoWay>
    extends akala.DualMetadata<

    TConnection,
    TServerOneWay,
    TServerTwoWay,
    TClientOneWay,
    TClientTwoWay,
    TServerOneWayProxy,
    TServerTwoWayProxy,
    TClientOneWayProxy,
    TClientTwoWayProxy,

    TOConnection,
    TOServerOneWay,
    TOServerTwoWay,
    TOClientOneWay,
    TOClientTwoWay,
    TOServerOneWayProxy,
    TOServerTwoWayProxy,
    TOClientOneWayProxy,
    TOClientTwoWayProxy>
{
    constructor(meta1: Meta<
        TConnection,
        TServerOneWay,
        TServerTwoWay,
        TClientOneWay,
        TClientTwoWay,
        TServerOneWayProxy,
        TServerTwoWayProxy,
        TClientOneWayProxy,
        TClientTwoWayProxy>,
        meta2: Meta<
            TOConnection,
            TOServerOneWay,
            TOServerTwoWay,
            TOClientOneWay,
            TOClientTwoWay,
            TOServerOneWayProxy,
            TOServerTwoWayProxy,
            TOClientOneWayProxy,
            TOClientTwoWayProxy>)
    {
        super(meta1, meta2);

    }

    public createServer(router: router.HttpRouter, path: string, serverImpl: TServerOneWay & TServerTwoWay, serverImpl2: TOServerOneWay & TOServerTwoWay):
        TServerOneWay & TServerTwoWay & Partial<TClientOneWay & TClientTwoWay> & TOServerOneWay & TOServerTwoWay & Partial<TOClientOneWay & TOClientTwoWay>
    {
        return createServerFromMeta(this)(router, path, akala.extend(serverImpl, serverImpl2));
    }

    public createClient(client: jsonrpc.Client<TConnection & TOConnection>, clientImpl: TClientOneWay & TClientTwoWay & TOClientOneWay & TOClientTwoWay):
        TClientOneWay & TClientTwoWay & TOClientOneWay & TOClientTwoWay & { $proxy(): Partial<TServerOneWayProxy & TServerTwoWayProxy & TOServerOneWayProxy & TOServerTwoWayProxy> }
    public createClient(client: jsonrpc.Client<TConnection & TOConnection>, clientImpl: TClientOneWay & TClientTwoWay, clientImpl2: TOClientOneWay & TOClientTwoWay):
        TClientOneWay & TClientTwoWay & TOClientOneWay & TOClientTwoWay & { $proxy(): Partial<TServerOneWayProxy & TServerTwoWayProxy & TOServerOneWayProxy & TOServerTwoWayProxy> }
    public createClient(client: jsonrpc.Client<TConnection & TOConnection>, clientImpl: TClientOneWay & TClientTwoWay, clientImpl2?: TOClientOneWay & TOClientTwoWay):
        TClientOneWay & TClientTwoWay & TOClientOneWay & TOClientTwoWay & { $proxy(): Partial<TServerOneWayProxy & TServerTwoWayProxy & TOServerOneWayProxy & TOServerTwoWayProxy> }
    {
        return super.createClient(client, akala.extend(clientImpl, clientImpl2));
    }
}

export var meta = new Meta()
    .connection<jsonrpc.Connection & { submodule?: string }>()
    .clientToServer<{ module: string }, { config: any, workers: any[] }>()({ module: true })
    .clientToServerOneWay<{ masterPath?: string, workerPath?: string }>()({ master: true })
    .serverToClientOneWay<void>()({ 'after-master': true, ready: true })
    ;