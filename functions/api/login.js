import {loginRequest} from '../../src/server-auth.js';
export async function onRequest({request,env}){return loginRequest(request,env);}
