import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { buildOpenApiConfig } from "./common/swagger/openapi.config";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(app, buildOpenApiConfig());
  SwaggerModule.setup("docs", app, document);

  app.enableCors({
    origin: ['http://localhost:3000', 'http://localhost:3002'], // Add your Next.js and Expo web ports
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: 'Content-Type, Accept, Authorization',
  });
  await app.listen(Number(process.env.API_PORT ?? 3001));
}

void bootstrap();
