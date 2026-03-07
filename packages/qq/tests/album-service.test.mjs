import test from "node:test";
import assert from "node:assert/strict";
import { createCollection, createFlashTask, deleteGroupAlbumMedia, doGroupAlbumComment, fetchEmojiLike, getCollectionList, getEmojiLikes, getFlashFileList, getFlashFileUrl, getGroupAlbumMediaList, getQunAlbumList, setGroupAlbumMediaLike, setMessageEmojiLike, uploadImageToQunAlbum } from "../.test-dist/src/services/album-service.js";
function createClient(){const calls=[];return{calls,client:{async invokeNapCatAction(action,params,ctx){calls.push({action,params,ctx});return {ok:true};}}};}
test("album service maps album, flash and emoji actions", async () => {
  const {calls,client}=createClient(); const ctx={route:"group:42",source:"chat",stage:"album"}; const p={group_id:42};
  for (const fn of [createCollection,getCollectionList,createFlashTask,getFlashFileList,getFlashFileUrl,getQunAlbumList,getGroupAlbumMediaList,uploadImageToQunAlbum,deleteGroupAlbumMedia,doGroupAlbumComment,setGroupAlbumMediaLike,fetchEmojiLike,getEmojiLikes,setMessageEmojiLike]) await fn(client,p,ctx);
  assert.deepEqual(calls.map(it=>it.action),["create_collection","get_collection_list","create_flash_task","get_flash_file_list","get_flash_file_url","get_qun_album_list","get_group_album_media_list","upload_image_to_qun_album","del_group_album_media","do_group_album_comment","set_group_album_media_like","fetch_emoji_like","get_emoji_likes","set_msg_emoji_like"]);
});
