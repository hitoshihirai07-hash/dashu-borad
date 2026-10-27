import {logoutRequest} from '../../src/server-auth.js';
export async function onRequest({request,env}){return logoutRequest(request,env);}
