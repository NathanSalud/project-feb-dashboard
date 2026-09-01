import { NestFactory } from '@nestjs/core';
import compression from 'compression';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Gzip API responses. The dashboard's aggregate JSON — especially the admin
  // (all-company) payloads — is highly repetitive and compresses ~5-10x, so this
  // is the cheapest win on admin load time. threshold: only compress bodies
  // above ~1KB (below that the CPU cost outweighs the byte savings).
  app.use(compression({ threshold: 1024 }));

  app.enableCors({
  origin: [process.env.FRONTEND_URL || 'http://localhost:5173', 'http://localhost:5173'],
  credentials: true,
});

  await app.listen(process.env.PORT || 3000);
}
bootstrap();