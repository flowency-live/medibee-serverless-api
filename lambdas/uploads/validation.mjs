/**
 * Uploads Lambda Validation Schemas
 */

import { z } from 'zod';

// Allowed content types for CV uploads
const ALLOWED_CV_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

// Presigned URL request schema
export const PresignedUrlSchema = z.object({
  contentType: z.string().min(1, 'Content type is required'),
  filename: z.string().min(1, 'Filename is required').max(255),
}).strict();

// Confirm upload request schema
export const ConfirmUploadSchema = z.object({
  key: z.string().min(1, 'Key is required'),
}).strict();

// Validate content type is allowed
export function isAllowedContentType(contentType) {
  return ALLOWED_CV_TYPES.includes(contentType);
}

// Get file extension from content type
export function getExtensionFromContentType(contentType) {
  switch (contentType) {
    case 'application/pdf':
      return 'pdf';
    case 'application/msword':
      return 'doc';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'docx';
    default:
      return null;
  }
}

// Magic bytes for file type validation
export const MAGIC_BYTES = {
  pdf: Buffer.from('%PDF-'),
  docx: Buffer.from([0x50, 0x4B, 0x03, 0x04]), // ZIP header (DOCX is a ZIP file)
  doc: Buffer.from([0xD0, 0xCF, 0x11, 0xE0]), // OLE2 header
};
