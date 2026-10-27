import {sessionRequest} from '../../src/server-auth.js';
export async function onRequest({request,env}){return sessionRequest(request,env);}
