import mime from 'mime-types';
import { Response } from 'express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  LinkAttachmentDto,
  UnlinkAttachmentDto,
  UploadAttachmentDto,
} from './dtos/Attachment.dto';
import { AttachmentsApplication } from './AttachmentsApplication';
import { AttachmentUploadPipeline } from './S3UploadPipeline';
import { FileInterceptor } from '@nestjs/platform-express'; // ✅ use Nest’s built-in one here
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ConfigService } from '@nestjs/config';
import { ApiCommonHeaders } from '@/common/decorators/ApiCommonHeaders';

@ApiTags('Attachments')
@Controller('/attachments')
@ApiCommonHeaders()
export class AttachmentsController {
  constructor(
    private readonly attachmentsApplication: AttachmentsApplication,
    private readonly uploadPipelineService: AttachmentUploadPipeline,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Uploads the attachments to S3 and store the file metadata to DB.
   */
  @Post()
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads', // adjust if you use tmp or local staging folder
        filename: (req, file, cb) => {
          const ext = extname(file.originalname);
          const key = `${uuidv4()}${ext}`;
          file.key = key; // ✅ propagate full name with extension
          cb(null, key);
        },
      }),
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload attachment to S3' })
  @ApiBody({ description: 'Upload attachment', type: UploadAttachmentDto })
  @ApiResponse({
    status: 200,
    description: 'The document has been uploaded successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - File upload failed',
  })
  async uploadAttachment(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new UnauthorizedException({
        errorType: 'FILE_UPLOAD_FAILED',
        message: 'No file uploaded.',
      });
    }

    const data = await this.attachmentsApplication.upload(file);

    return {
      status: 200,
      message: 'The document has uploaded successfully.',
      data,
    };
  }

  /**
   * Retrieves the given attachment key.
   */
  @Get('/:id')
  @ApiOperation({ summary: 'Get attachment by ID' })
  @ApiParam({ name: 'id', description: 'Attachment ID' })
  @ApiResponse({ status: 200, description: 'Returns the attachment file' })
  async getAttachment(
    @Res() res: Response,
    @Param('id') documentId: string,
  ): Promise<Response | void> {
    const data = await this.attachmentsApplication.get(documentId);
    const byte = await data.Body.transformToByteArray();
    const extension = mime.extension(data.ContentType);
    const buffer = Buffer.from(byte);

    res.set('Content-Disposition', `filename="${documentId}.${extension}"`);
    res.set('Content-Type', data.ContentType);
    res.send(buffer);
  }

  @Delete('/:id')
  @ApiOperation({ summary: 'Delete attachment by ID' })
  @ApiParam({ name: 'id', description: 'Attachment ID' })
  @ApiResponse({
    status: 200,
    description: 'The document has been deleted successfully',
  })
  async deleteAttachment(@Param('id') documentId: string) {
    await this.attachmentsApplication.delete(documentId);

    return {
      status: 200,
      message: 'The document has been deleted successfully.',
    };
  }

  @Post('/:id/link')
  @ApiOperation({ summary: 'Link attachment to a model' })
  @ApiParam({ name: 'id', description: 'Attachment ID' })
  @ApiBody({ type: LinkAttachmentDto })
  async linkDocument(
    @Body() linkDocumentDto: LinkAttachmentDto,
    @Param('id') documentId: string,
  ) {
    await this.attachmentsApplication.link(
      documentId,
      linkDocumentDto.modelRef,
      linkDocumentDto.modelId,
    );

    return {
      status: 200,
      message: 'The document has been linked successfully.',
    };
  }

  @Post('/:id/unlink')
  @ApiOperation({ summary: 'Unlink attachment from a model' })
  @ApiParam({ name: 'id', description: 'Attachment ID' })
  @ApiBody({ type: UnlinkAttachmentDto })
  async unlinkDocument(
    @Body() unlinkDto: UnlinkAttachmentDto,
    @Param('id') documentId: string,
  ) {
    await this.attachmentsApplication.link(
      documentId,
      unlinkDto.modelRef,
      unlinkDto.modelId,
    );

    return {
      status: 200,
      message: 'The document has been unlinked successfully.',
    };
  }

  @Get('/:id/presigned-url')
  @ApiOperation({ summary: 'Get presigned URL for attachment' })
  @ApiParam({ name: 'id', description: 'Attachment ID' })
  async getAttachmentPresignedUrl(@Param('id') documentKey: string) {
    const presignedUrl =
      await this.attachmentsApplication.getPresignedUrl(documentKey);

    return { presignedUrl };
  }
}
