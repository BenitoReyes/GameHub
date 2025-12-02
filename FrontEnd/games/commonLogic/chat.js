// Small wrapper for connecting to Stream Chat used by games
export async function connectChat({ apiKey, userId, token, username }) {
    try {
        // Use global StreamChat if the bundle is included in the page
        const client = (typeof StreamChat !== 'undefined') ? StreamChat.getInstance(apiKey) : null;
        if (client?.user) await client.disconnect();
        await client.connectUser({ id: userId, name: username }, token);
        return client;
    } catch (err) {
        console.error('connectChat error:', err);
        throw err;
    }
}
