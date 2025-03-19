import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import {OrderService} from "../core/order.service";
import {CronType} from "@daechanjo/models";


@Controller()
export class OrderController {
	constructor(private readonly orderService: OrderService) {}

	@MessagePattern('order-queue')
	async handlePriceMessage(message: any) {
		const { pattern, payload } = message;
		console.log(`${payload.type}${payload.cronId}: 📥${pattern}`);
		switch (pattern) {
			default:
				console.error(
					`${CronType.ERROR}${payload.type}${payload.cronId}: 📥알 수 없는 패턴 유형 ${pattern}`,
				);
				return { status: 'error', message: `알 수 없는 패턴 유형: ${pattern}` };
		}
	}
}
