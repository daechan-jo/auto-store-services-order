import { JobType, RabbitmqMessage } from '@daechanjo/models';
import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';

import { OrderService } from '../core/order.service';

@Controller()
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @MessagePattern('order-queue')
  async handlePriceMessage(message: RabbitmqMessage) {
    const { pattern, payload } = message;
    console.log(`${payload.jobType}${payload.jobId}: 📥${pattern}`);
    switch (pattern) {
      default:
        console.error(
          `${JobType.ERROR}${payload.jobType}${payload.jobId}: 📥알 수 없는 패턴 유형 ${pattern}`,
        );
        return { status: 'error', message: `알 수 없는 패턴 유형: ${pattern}` };
    }
  }
}
