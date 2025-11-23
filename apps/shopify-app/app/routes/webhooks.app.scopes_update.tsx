import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";

type AppScopesUpdatePayload = {
    current: string[];
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { payload, session, topic, shop } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);

    const typedPayload = payload as AppScopesUpdatePayload;
    if (session) {
        await db.session.update({
            where: {
                id: session.id
            },
            data: {
                scope: typedPayload.current.toString(),
            },
        });
    }
    return new Response();
};
