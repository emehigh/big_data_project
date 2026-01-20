import axios from 'axios';
import * as cheerio from 'cheerio';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

interface ImageMetadata {
  url: string;
  filename: string;
  category: string;
  source: string;
}

// ImageNet URLS API (example endpoints)
const IMAGENET_CATEGORIES = [
  'n02084071', // dog
  'n02121808', // cat  
  'n03792782', // mountain bike
  'n04285008', // sports car
  'n02690373', // airliner
  'n03100240', // convertible
  'n02814533', // beach wagon
  'n04037443', // racer
  'n03594945', // jeep
  'n03670208', // limousine
];

class DatasetIngester {
  private baseUrl = 'http://www.image-net.org';
  private outputDir = './datasets/imagenet';
  private apiEndpoint = process.env.API_ENDPOINT || 'http://localhost:3000';

  async downloadImagenetBatch(
    categoryId: string,
    maxImages: number = 100
  ): Promise<ImageMetadata[]> {
    console.log(`📥 Downloading category ${categoryId}...`);

    try {
      // Get image URLs from ImageNet API
      const response = await axios.get(
        `${this.baseUrl}/api/text/imagenet.synset.geturls?wnid=${categoryId}`
      );

      const urls = response.data
        .split('\n')
        .filter((url: string) => url.trim().length > 0)
        .slice(0, maxImages);

      console.log(`  Found ${urls.length} images for ${categoryId}`);

      const metadata: ImageMetadata[] = urls.map((url: string, idx: number) => ({
        url,
        filename: `${categoryId}_${idx}.jpg`,
        category: categoryId,
        source: 'imagenet',
      }));

      return metadata;
    } catch (error) {
      console.error(`  Error downloading ${categoryId}:`, error);
      return [];
    }
  }

  async downloadImageFromUrl(url: string, outputPath: string): Promise<boolean> {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 10000,
        maxContentLength: 10 * 1024 * 1024, // 10MB max
      });

      await writeFile(outputPath, response.data);
      return true;
    } catch (error) {
      console.error(`  Failed to download ${url}:`, (error as Error).message);
      return false;
    }
  }

  async ingestToAPI(imagePaths: string[], datasetName: string): Promise<void> {
    console.log(`📤 Uploading ${imagePaths.length} images to API...`);

    const BATCH_SIZE = 50;
    for (let i = 0; i < imagePaths.length; i += BATCH_SIZE) {
      const batch = imagePaths.slice(i, Math.min(i + BATCH_SIZE, imagePaths.length));
      
      console.log(`  Uploading batch ${Math.floor(i / BATCH_SIZE) + 1}...`);

      const formData = new FormData();
      formData.append('datasetName', datasetName);
      formData.append('batchSize', '20');

      for (const path of batch) {
        const file = await import('fs').then(fs => fs.readFileSync(path));
        const blob = new Blob([file]);
        formData.append('images', blob, path.split('/').pop() || 'image.jpg');
      }

      try {
        await axios.post(`${this.apiEndpoint}/api/ingest`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        console.log(`  ✓ Batch ${Math.floor(i / BATCH_SIZE) + 1} uploaded`);
      } catch (error) {
        console.error(`  ✗ Batch upload failed:`, (error as Error).message);
      }
    }
  }

  async runIngestion(
    categories: string[] = IMAGENET_CATEGORIES,
    imagesPerCategory: number = 100
  ): Promise<void> {
    console.log('🚀 Starting ImageNet ingestion...');
    console.log(`  Categories: ${categories.length}`);
    console.log(`  Images per category: ${imagesPerCategory}`);

    // Create output directory
    await mkdir(this.outputDir, { recursive: true });

    const allImagePaths: string[] = [];

    for (const categoryId of categories) {
      console.log(`\n📂 Processing category: ${categoryId}`);

      // Get image URLs
      const metadata = await this.downloadImagenetBatch(categoryId, imagesPerCategory);

      // Download images
      let successCount = 0;
      for (let i = 0; i < metadata.length; i++) {
        const meta = metadata[i];
        const outputPath = join(this.outputDir, meta.filename);

        const success = await this.downloadImageFromUrl(meta.url, outputPath);
        if (success) {
          successCount++;
          allImagePaths.push(outputPath);
        }

        // Progress indicator
        if ((i + 1) % 10 === 0) {
          console.log(`  Progress: ${i + 1}/${metadata.length} (${successCount} successful)`);
        }
      }

      console.log(`  ✓ Downloaded ${successCount}/${metadata.length} images from ${categoryId}`);
    }

    console.log(`\n✅ Total images downloaded: ${allImagePaths.length}`);

    // Ingest to API
    if (allImagePaths.length > 0) {
      await this.ingestToAPI(allImagePaths, 'imagenet');
    }

    console.log('\n🎉 Ingestion complete!');
  }
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  const imagesPerCategory = parseInt(args[0]) || 100;
  const categories = args.length > 1 ? args.slice(1) : IMAGENET_CATEGORIES;

  const ingester = new DatasetIngester();
  ingester.runIngestion(categories, imagesPerCategory)
    .then(() => {
      console.log('✓ Script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('✗ Script failed:', error);
      process.exit(1);
    });
}

export { DatasetIngester, IMAGENET_CATEGORIES };
