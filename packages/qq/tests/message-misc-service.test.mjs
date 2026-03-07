import test from "node:test";
import assert from "node:assert/strict";
import { forwardFriendSingleMessage, forwardGroupSingleMessage, getDoubtFriendsAddRequest, getShareLink, sendGroupSign, sendMessage, sendPacket, setDoubtFriendsAddRequest } from "../.test-dist/src/services/message-misc-service.js";
function createClient(){const calls=[];return{calls,client:{async invokeNapCatAction(action,params,ctx){calls.push({action,params,ctx});return {ok:true};}}};}
test("message misc service maps misc messaging actions", async () => {
  const {calls,client}=createClient(); const ctx={route:"user:1",source:"chat",stage:"misc"}; const p={foo:"bar"};
  for (const fn of [forwardFriendSingleMessage,forwardGroupSingleMessage,getDoubtFriendsAddRequest,getShareLink,sendMessage,sendGroupSign,sendPacket,setDoubtFriendsAddRequest]) await fn(client,p,ctx);
  assert.deepEqual(calls.map(it=>it.action),["forward_friend_single_msg","forward_group_single_msg","get_doubt_friends_add_request","get_share_link","send_msg","send_group_sign","send_packet","set_doubt_friends_add_request"]);
});
