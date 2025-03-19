import { CoupangOrder, CronType } from '@daechanjo/models';
import { RabbitMQService } from '@daechanjo/rabbitmq';
import { UtilService } from '@daechanjo/util';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import moment from 'moment';

@Injectable()
export class OrderService {
  constructor(
    private readonly configService: ConfigService,
    private readonly rabbitmqService: RabbitMQService,
    private readonly utilService: UtilService,
  ) {}

  async orderManagement(type: string, cronId: string) {
    const today = moment().format('YYYY-MM-DD');
    const yesterday = moment().subtract(1, 'days').format('YYYY-MM-DD');

    const newOrderProducts: CoupangOrder = await this.rabbitmqService.send(
      'coupang-queue',
      'getCoupangOrderList',
      {
        cronId: cronId,
        type: CronType.ORDER,
        status: 'ACCEPT',
        vendorId: this.configService.get<string>('L_COUPANG_VENDOR_ID')!,
        today: today,
        yesterday: yesterday,
      },
    );

    if (newOrderProducts.data.length <= 0) {
      console.log(`${type}${cronId}: 주문 데이터가 없습니다.`);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 새로운 모든 주문 상품준비중 처리
    await this.rabbitmqService.emit('coupang-queue', 'orderStatusUpdate', {
      cronId: cronId,
      type: CronType.ORDER,
    });

    const result = await this.rabbitmqService.send('onch-queue', 'automaticOrdering', {
      cronId: cronId,
      store: this.configService.get<string>('STORE'),
      newOrderProducts: newOrderProducts.data,
      type: CronType.ORDER,
    });

    const successOrders = result.data.filter((result: any) => result.status === 'success');
    const failedOrders = result.data.filter((result: any) => result.status === 'failed');

    if (successOrders.length > 0) {
      try {
        setImmediate(async () => {
          await this.rabbitmqService.emit('mail-queue', 'sendSuccessOrders', {
            result: successOrders,
            store: this.configService.get<string>('STORE'),
          });
        });
        console.log(`${type}${cronId}: 성공 이메일 전송 완료`);
      } catch (error: any) {
        console.error(
          `${CronType.ERROR}${type}${cronId}: 성공 이메일 전송 실패\n`,
          error.response?.data || error.message,
        );
      }
    }

    if (failedOrders.length > 0) {
      try {
        setImmediate(async () => {
          await this.rabbitmqService.emit('mail-queue', 'sendFailedOrders', {
            result: failedOrders,
            store: this.configService.get<string>('STORE'),
            cronId: cronId,
          });
        });
        console.log(`${type}${cronId}: 실패 이메일 전송 완료`);
      } catch (error: any) {
        console.error(
          `${CronType.ERROR}${type}${cronId}: 실패 이메일 전송 실패\n`,
          error.response?.data || error.message,
        );
      }
    }
  }

  @Cron('0 */5 * * * *')
  async orderCron() {
    const cronId = this.utilService.generateCronId();
    try {
      const nowTime = moment().format('HH:mm:ss');
      console.log(`${CronType.ORDER}${cronId}-${nowTime}: 자동 발주 시작`);

      await this.orderManagement(CronType.ORDER, cronId);
    } catch (error: any) {
      console.error(`${CronType.ERROR}${CronType.ORDER}${cronId}: `, error);

      await this.rabbitmqService.emit('mail-queue', 'sendErrorMail', {
        cronType: CronType.ORDER,
        store: this.configService.get<string>('STORE'),
        cronId: cronId,
        message: error.message,
      });
    }
  }
}
