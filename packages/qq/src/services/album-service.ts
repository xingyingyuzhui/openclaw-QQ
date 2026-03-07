import type { OneBotClient } from "../client.js";
import type { NapCatInvokeCtx } from "./message-service.js";

export async function createCollection(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("create_collection", params, ctx);
}

export async function getCollectionList(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_collection_list", params, ctx);
}

export async function createFlashTask(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("create_flash_task", params, ctx);
}

export async function getFlashFileList(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_flash_file_list", params, ctx);
}

export async function getFlashFileUrl(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_flash_file_url", params, ctx);
}

export async function getQunAlbumList(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_qun_album_list", params, ctx);
}

export async function getGroupAlbumMediaList(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_group_album_media_list", params, ctx);
}

export async function uploadImageToQunAlbum(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("upload_image_to_qun_album", params, ctx);
}

export async function deleteGroupAlbumMedia(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("del_group_album_media", params, ctx);
}

export async function doGroupAlbumComment(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("do_group_album_comment", params, ctx);
}

export async function setGroupAlbumMediaLike(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("set_group_album_media_like", params, ctx);
}

export async function fetchEmojiLike(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("fetch_emoji_like", params, ctx);
}

export async function getEmojiLikes(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_emoji_likes", params, ctx);
}

export async function setMessageEmojiLike(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("set_msg_emoji_like", params, ctx);
}
