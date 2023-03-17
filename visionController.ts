import * as functions from "firebase-functions";
// import {PubSub} from '@google-cloud/pubsub';
import { ImageAnnotatorClient } from "@google-cloud/vision";
import { Message } from "firebase-functions/v1/pubsub";
import { VISION_QUEUE_TOPIC_NAME, CHANGE_DISPLAY_REQUEST_TOPIC_NAME } from './constants';
import { ChangeDisplayData } from "./types";
import { firestore } from './coldStart'
import { publishMessage, isAdmin, downloadImage } from "./helpers";
import { sendEmail } from "./emailController";

export const processImageWithVision = functions.runWith({minInstances:1}).pubsub.topic(VISION_QUEUE_TOPIC_NAME).onPublish(async (message: Message, context)=> {
    const changeData: ChangeDisplayData = message.json;
    const timestamp = new Date()
    try {
        const imageUri = changeData.castPayload.imageUrl;
        const imageBase64 = await downloadImage(imageUri)
        const client = new ImageAnnotatorClient();
        // const [result] = await client.safeSearchDetection(imageUri)
        const [result] = await client.safeSearchDetection({image: {content:imageBase64}})
        const labels = result.safeSearchAnnotation;
        
        if (labels === null) {
                    //couldn't process the image, 
            throw new Error(`vision not conclusive for image : ${imageUri}`)
        }
        let isSafe = true
        const needsApproval = resultKeys.map(key => {
            if (labels[key] === 'LIKELY' || labels[key] === 'VERY_LIKELY') {
                isSafe = false
                return { [key]: labels[key]}
            } else {
                return null
            }
        }).filter( k => k !== null)
        if (isSafe) {
            await firestore.collection('displayRequestLogs').doc(changeData.logId).update({
                timestamp: context.timestamp,
                epoch: timestamp.valueOf(),
                visionInfo: labels,
                logId: changeData.logId,
                status: 'visionApproved',
            })
            await publishMessage({...changeData}, CHANGE_DISPLAY_REQUEST_TOPIC_NAME)
        } else {
            await firestore.collection('displayRequestLogs').doc(changeData.logId).update({
                timestamp: context.timestamp,
                epoch: timestamp.valueOf(),
                logId: changeData.logId,
                status: 'visionDenied',
                visionInfo: labels,
                visionNeedsApproval: needsApproval
            })
            await sendEmail({
                message: 'Vision denied',
                status: 'visionDenied',
                image: changeData.castPayload.imageUrl,
                frameId: changeData.frameId,
                deviceId: changeData.deviceId,
            })
        }
        return
    } catch (error) {
        await firestore.collection('displayRequestLogs').doc(changeData.logId).update({
            timestamp: context.timestamp,
            epoch: timestamp.valueOf(),
            logId: changeData.logId,
            status: 'visionError',
            errorMessage: error.message
        })
        return
    }


})

export const approveImage = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        // Throwing an HttpsError so that the client gets the error details.
        throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
            'while authenticated.');
    }
    const authorized = await isAdmin(context.auth.uid);
    if (!authorized) {
        throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
            'as an admin');
    }
    if (!data.changeData) {
        throw new functions.https.HttpsError('invalid-argument', 'The function must be called ' +
        'with a changeData');
    }

    try {
        await publishMessage({...data.changeData}, CHANGE_DISPLAY_REQUEST_TOPIC_NAME)
        await firestore.collection('displayRequestLogs').doc(data.changeData.logId).update({
            status: 'visionApproved',
        })
        return {
            status: 'success',
            message: 'request approved !'
        }

    } catch (err) {
        return {
            status: 'error',
            message: err.message
        }
    }
})

const resultKeys = ['adult', 'medical', 'violence', 'racy']

enum Likelihood {
    UNKNOWN = 0,
    VERY_UNLIKELY = 1,
    UNLIKELY = 2,
    POSSIBLE = 3,
    LIKELY = 4,
    VERY_LIKELY = 5
}