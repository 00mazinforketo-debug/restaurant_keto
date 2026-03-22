export declare const createUploadSignature: (folder: string) => {
    timestamp: number;
    signature: string;
    apiKey: string | undefined;
    cloudName: string | undefined;
    folder: string;
};
