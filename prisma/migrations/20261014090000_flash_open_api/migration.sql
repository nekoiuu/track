-- Flash Open API: หลักฐานการส่งถึง + ป้ายปัญหาจาก webhook
ALTER TABLE "ManifestParcel" ADD COLUMN     "flashMarker" INTEGER,
ADD COLUMN     "flashPod" JSONB,
ADD COLUMN     "flashPodAt" TIMESTAMP(3);
