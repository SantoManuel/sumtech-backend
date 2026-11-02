import { Equals, IsBoolean } from 'class-validator';
export class RetryOnuWanDto {
  @IsBoolean() @Equals(true) acknowledged: boolean;
}
