import { Test, TestingModule } from '@nestjs/testing';

import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';

describe('AppController (e2e)', () => {
  let moduleFixture: TestingModule;
  let controller: AppController;

  beforeEach(async () => {
    moduleFixture = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    controller = moduleFixture.get(AppController);
  });

  afterEach(async () => {
    await moduleFixture.close();
  });

  it('/ (GET)', () => {
    expect(controller.getHello()).toBe('Hello World!');
  });
});
