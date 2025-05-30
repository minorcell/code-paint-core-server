import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as qiniu from 'qiniu';
import { Upload } from './entities/upload.entity';

@Injectable()
export class UploadService {
  private mac: qiniu.auth.digest.Mac;
  private config: qiniu.conf.Config;
  private bucketManager: qiniu.rs.BucketManager;
  private uploadToken: string;

  constructor(
    private configService: ConfigService,
    @InjectRepository(Upload)
    private uploadRepository: Repository<Upload>,
  ) {
    // 初始化七牛云配置
    this.mac = new qiniu.auth.digest.Mac(
      this.configService.get('kodo.ACCESS_KEY'),
      this.configService.get('kodo.SECRET_KEY'),
    );
    this.config = new qiniu.conf.Config();
    this.bucketManager = new qiniu.rs.BucketManager(this.mac, this.config);
    const putPolicy = new qiniu.rs.PutPolicy({
      scope: this.configService.get('kodo.BUCKET'),
    });
    this.uploadToken = putPolicy.uploadToken(this.mac);
  }

  async uploadFile(file: Express.Multer.File) {
    const formUploader = new qiniu.form_up.FormUploader(this.config);
    const putExtra = new qiniu.form_up.PutExtra();

    return new Promise<Upload>((resolve, reject) => {
      formUploader.put(
        this.uploadToken,
        null, // 使用七牛云生成的文件名
        file.buffer,
        putExtra,
        async (err, body, info) => {
          try {
            // 检查是否有错误
            if (err) {
              console.error('Upload error:', err);
              return reject(
                new Error('File upload failed due to an internal error.'),
              );
            }

            // 检查 HTTP 状态码是否为成功
            if (info.statusCode !== 200) {
              console.error('Upload failed with status code:', info.statusCode);
              return reject(
                new Error(
                  `File upload failed with status code: ${info.statusCode}`,
                ),
              );
            } // 获取基础 URL 并构造上传对象
            const baseUrl = this.configService.get('kodo.BASE_URL');
            const upload = new Upload();
            upload.hash = body.hash;
            upload.key = body.key;
            upload.url = `${baseUrl}/${body.key}`;

            // 将上传信息保存到数据库
            try {
              const savedUpload = await this.uploadRepository.save(upload);
              resolve(savedUpload); // 成功时返回保存的对象
            } catch (dbError) {
              console.error('Database save error:', dbError);
              reject(
                new Error('Failed to save upload information to the database.'),
              );
            }
          } catch (unexpectedError) {
            // 捕获任何意外错误
            console.error('Unexpected error during upload:', unexpectedError);
            reject(
              new Error('An unexpected error occurred during file upload.'),
            );
          }
        },
      );
    });
  }

  async getFiles(page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;
    const [items, total] = await this.uploadRepository.findAndCount({
      skip,
      take: limit,
      order: { createdAt: 'DESC' },
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
