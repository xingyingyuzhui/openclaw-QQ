import test from "node:test";
import assert from "node:assert/strict";
import { downloadFileset, getFilesetId, getFilesetInfo, sendOnlineFolder, transGroupFile } from "../.test-dist/src/services/fileset-service.js";
function createClient(){const calls=[];return{calls,client:{async invokeNapCatAction(action,params,ctx){calls.push({action,params,ctx});return {ok:true};}}};}
test("fileset service maps fileset and folder transfer actions", async () => {
  const {calls,client}=createClient(); const ctx={route:"group:42",source:"chat",stage:"fileset"}; const p={id:"x"};
  for (const fn of [downloadFileset,getFilesetId,getFilesetInfo,transGroupFile,sendOnlineFolder]) await fn(client,p,ctx);
  assert.deepEqual(calls.map(it=>it.action),["download_fileset","get_fileset_id","get_fileset_info","trans_group_file","send_online_folder"]);
});
