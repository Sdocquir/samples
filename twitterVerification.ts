import { TwitterApi } from "twitter-api-v2";
import { TwitterApiRateLimitPlugin } from "@twitter-api-v2/plugin-rate-limit";
import { TWITTER_CONSUMER_KEY, TWITTER_CONSUMER_SECRET } from "../env";
import { db } from "../db";
import { VerificationRequirementResult } from "../types";
import { twitter } from "functions/oauth/oauth1";
import { updateTwitterIntentVerificationRecord, updateTwitterRecord, updatedVerificationTwitterRecord } from "functions/db-queries";
import { FAILURE_REASON } from "functions/types";

export const getTwitterClientById = async (twitterId : string) => {
    const twitterRecord = await db
        .selectFrom('twitter')
        .selectAll()
        .where('twitter_id', "=", twitterId).executeTakeFirst();
    if (!twitterRecord || !twitterRecord.access_token || !twitterRecord.access_secret) {
      return {};
    }
    try {
      const rateLimitPlugin = new TwitterApiRateLimitPlugin()
      const client = new TwitterApi({
          appKey: TWITTER_CONSUMER_KEY,
          appSecret: TWITTER_CONSUMER_SECRET,
          accessToken: twitterRecord.access_token,
          accessSecret: twitterRecord.access_secret,
      }, {plugins: [rateLimitPlugin]});
      return {client, rateLimitPlugin}
    } catch (e) {
      console.log(e)
      return {}
    }
}

export const verifyTwitterRequirement = async (intentRecord: any, verificationRecord: any) : Promise<VerificationRequirementResult> => {
    if (intentRecord.twitter_required && !verificationRecord.twitter_id) {
        return {
                verificationResult: false,
                failedMessage: "Twitter verification required",
                failureReason: FAILURE_REASON.OAUTH_REQUIRED
            }
    }
    const twitterIdsToFollow = 
        intentRecord.twitter_required ?
        intentRecord.twitter_ids?.split(',') ?? []
        : []
    if (twitterIdsToFollow?.length > 0 && verificationRecord.twitter_id){
        const {client: loggedClient, rateLimitPlugin } = await getTwitterClientById(verificationRecord.twitter_id)
        if (!loggedClient) {
            updateTwitterRecord({
                twitterId: verificationRecord.twitter_id,
                twitterHandle: verificationRecord.twitter_handle,
                accessToken: null,
                accessSecret: null,
                tokenScope: null,
            })
            await updatedVerificationTwitterRecord(verificationRecord.wallet_address, null, null,null)
            return {
                    verificationResult: false,
                    failedMessage: "Twitter access has expired or was revoked",
                    failureReason: FAILURE_REASON.OAUTH_EXPIRED
                }
        };
        if (intentRecord.twitter_force_action) {
            await Promise.all(twitterIdsToFollow.map((twitterId: string) => {
                return loggedClient.v1.createFriendship({user_id: twitterId, follow: true })
            }))
        } else {
            let needToFollow = [...twitterIdsToFollow]
            let followed: string[] = []
            let reachedPaginationEnd = false;
            let followsAll = false;
            let followList: any;
            let rateLimit: any;
            try {
                followList = await loggedClient.v2.following(verificationRecord.twitter_id, {max_results: 1000})
                while (reachedPaginationEnd === false && followsAll === false) {
                    rateLimit= await rateLimitPlugin.v2.getRateLimit("users/:id/following", "GET")
                    if (!followList ||
                        !followList.data ||
                        !followList.data.length ||
                        needToFollow.length > 0
                    ){  
                            if  (!followList || !followList.data){
                                return {
                                    verificationResult: false,
                                    idsFound: followed,
                                    rateLimit: rateLimit?.remaining,
                                    failedMessage:"You must follow the indicated twitter account(s)",
                                    failureReason: FAILURE_REASON.REQUIREMENTS_NOT_MET
                                    }
                            }
                            const idsFound = twitterIdsToFollow.map((idToFollow: string) => 
                                followList.data.find((follow:any) => follow.id === idToFollow) ? idToFollow : undefined).filter( Boolean )
                            needToFollow = needToFollow.filter((id: string) => !idsFound.includes(id))
                            followed = [...followed, ...idsFound]
                            if (needToFollow.length === 0) {
                                return {
                                    verificationResult: true,
                                    idsFound: twitterIdsToFollow,
                                    rateLimit,
                                };
                            }
                            if (rateLimit?.remaining === 0) {
                                return {
                                    verificationResult: false,
                                    idsFound: followed,
                                    rateLimit,
                                    failedMessage: "You have reached the Twitter api rate limit",
                                    failureReason: FAILURE_REASON.RATE_LIMIT_REACHED
                                }
                            }
                            if (followList.meta?.result_count === 1000 && followList.meta?.next_token) {
                                followList = await loggedClient.v2.following(verificationRecord.twitter_id, {max_results: 1000, pagination_token: followList.meta?.next_token})
                            }else {
                                reachedPaginationEnd = true
                                return {
                                    verificationResult: false,
                                    idsFound: followed,
                                    rateLimit: rateLimit?.remaining,
                                    failedMessage:"You must follow the indicated twitter account(s)",
                                    failureReason: FAILURE_REASON.REQUIREMENTS_NOT_MET
                                    }
                            };
                    } else {
                        followsAll = true;
                    }
                }
            } catch(e: any){ 
                rateLimit= await rateLimitPlugin.v2.getRateLimit("users/:id/following", "GET")
                console.log("twitterApiError")
                console.log(verificationRecord.twitter_handle)
                console.log(followList)
                console.log(rateLimit)
                console.log(e.message)
                console.log(e.code)
                console.log(e.data)
                console.log(e)
                if (rateLimit?.remaining === 0 || e?.message?.includes('429')) {
                    return {
                        verificationResult: false,
                        idsFound: followed,
                        rateLimit,
                        failedMessage: "You have reached the Twitter api rate limit",
                        failureReason: FAILURE_REASON.RATE_LIMIT_REACHED
                    }
                }
                else if ( e?.message?.includes('401')) {
                    await updatedVerificationTwitterRecord(verificationRecord.wallet_address, null, null, null)
                    return {
                        verificationResult: false,
                        idsFound: followed,
                        rateLimit,
                        failedMessage: "Twitter access has expired or was revoked",
                        failureReason: FAILURE_REASON.OAUTH_EXPIRED
                    }
                } else if (e?.message?.includes('403')) { 
                    await updatedVerificationTwitterRecord(verificationRecord.wallet_address, null, null, null)
                    return {
                        verificationResult: false,
                        idsFound: followed,
                        rateLimit,
                        failedMessage: "Twitter account is suspended",
                        failureReason: FAILURE_REASON.ACCOUNT_LOCKED
                    }
                }
                else {
                    return {
                        verificationResult: false,
                        idsFound: followed,
                        rateLimit,
                        failedMessage:"Twitter Api Error. Please try again later",
                        failureReason: FAILURE_REASON.UNKNOWN_ERROR
                        }
                }
            }
        }
    }
    return {
        verificationResult: true,
        idsFound: twitterIdsToFollow,
    }
}